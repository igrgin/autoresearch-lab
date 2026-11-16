import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

// Each store owns an independent, append-only numbered migration sequence.
// No existing schema is reset, including a database from a newer application.
export function openStore(filename: string, initialSql: string): Database.Database {
  const existed = existsSync(filename);
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
    const checksum = createHash('sha256').update(initialSql).digest('hex');
    if (tables.length) {
      const migrations = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string }[];
      if (migrations.length !== 1 || migrations[0].version !== 1 || migrations[0].checksum !== checksum) {
        throw new Error('Unsupported database schema version. Open it with a compatible application; the database was left intact.');
      }
    } else {
      // A consistent backup is required before future upgrades. Version 1 only
      // initializes empty stores and never upgrades existing user records.
      if (existed && tables.length === 0 && db.pragma('user_version', { simple: true }) !== 0) {
        throw new Error('Unsupported empty database version. Restore a supported backup.');
      }
      db.transaction(() => {
        db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
        db.exec(initialSql);
        db.prepare('INSERT INTO schema_migrations VALUES (1, ?)').run(checksum);
        db.pragma('user_version = 1');
      })();
    }
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('Local WAL storage is unavailable. Use a local writable workspace.');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || db.pragma('synchronous', { simple: true }) !== 2) {
      throw new Error('Required durable storage settings are unavailable.');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
