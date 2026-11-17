import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function sync(filename: string) {
  const fd = openSync(filename, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

const initialized = 'lab-store/1\n';
function plainFile(filename: string): boolean {
  try {
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Store recovery requires its original regular file.');
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function marked(filename: string): boolean {
  if (!plainFile(filename)) return false;
  if (readFileSync(filename, 'utf8') !== initialized) throw new Error('Store initialization evidence is unavailable. Restore a supported backup.');
  return true;
}
function mark(filename: string): void {
  let fd;
  try {
    fd = openSync(filename, 'wx', 0o600);
    writeFileSync(fd, initialized); fsyncSync(fd);
  } catch (error) {
    // Separate catalog processes may open the same already-valid store.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !marked(filename)) throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
  sync(path.dirname(filename));
}

// Each store owns an independent, append-only numbered migration sequence.
// No existing schema is reset, including a database from a newer application.
export function openStore(filename: string, initialSql: string, upgrades: readonly string[] = []): Database.Database {
  const marker = `${filename}.initialized`;
  const established = marked(marker);
  const existed = plainFile(filename);
  if (established && !existed) throw new Error('Established store is missing. Restore its original file or a supported backup.');
  if (!existed) {
    const fd = openSync(filename, 'wx', 0o600);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  const db = new Database(filename);
  try {
    const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
    const [major, minor, patch] = version.split('.').map(Number);
    if (major < 3 || (major === 3 && (minor < 51 || (minor === 51 && patch < 3)))) {
      throw new Error('SQLite 3.51.3 or later is required.');
    }
    db.pragma('busy_timeout = 5000');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    if (tables.length && !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get()) {
      throw new Error('Unrecognized database schema. Restore a supported backup; the database was left intact.');
    }
    const scripts = [initialSql, ...upgrades];
    const checksums = scripts.map((sql) => createHash('sha256').update(sql).digest('hex'));
    let current = 0;
    if (tables.length) {
      const migrations = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string }[];
      if (!migrations.length || migrations.length > scripts.length || migrations.some((m, i) => m.version !== i + 1 || m.checksum !== checksums[i])) {
        throw new Error('Unsupported database schema version. Open it with a compatible application; the database was left intact.');
      }
      current = migrations.length;
    } else {
      // A pre-existing empty file might replace lost authority. It cannot prove
      // this is first use, even when SQLite user_version is zero.
      if (existed || established) throw new Error('Empty store requires recovery. Restore its original file or a supported backup.');
    }
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('Local WAL storage is unavailable. Use a local writable workspace.');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || db.pragma('synchronous', { simple: true }) !== 2) {
      throw new Error('Required durable storage settings are unavailable.');
    }
    if (current < scripts.length) {
      // A consistent SQLite snapshot includes committed WAL content. Never
      // overwrite a backup. Failed migrations roll back without resetting data.
      if (current) {
        const backup = `${filename}.before-v${current + 1}-${randomUUID()}.sqlite`;
        db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
        chmodSync(backup, 0o600);
        sync(backup); sync(path.dirname(backup));
      }
      db.transaction(() => {
        if (!current) db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
        for (let i = current; i < scripts.length; i++) {
          db.exec(scripts[i]);
          db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(i + 1, checksums[i]);
        }
        db.pragma(`user_version = ${scripts.length}`);
        const foreignKeys = db.pragma('foreign_key_check');
        if (db.pragma('quick_check', { simple: true }) !== 'ok' || !Array.isArray(foreignKeys) || foreignKeys.length) throw new Error('Database migration validation failed. Restore the consistent backup.');
      }).immediate();
    }
    if (!established) mark(marker);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
