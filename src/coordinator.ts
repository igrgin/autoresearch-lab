import Database from 'better-sqlite3';

// Qualify the native binding in its chosen host without creating product stores.
// Durable registry/history schemas and migrations belong to dependent tasks.
const db = new Database(':memory:');
const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
const [major, minor, patch] = version.split('.').map(Number);
if (major < 3 || (major === 3 && (minor < 51 || (minor === 51 && patch < 3)))) {
  throw new Error('SQLite 3.51.3 or later is required.');
}
db.close();
process.parentPort.postMessage({ coordinator: 'ready', sqliteVersion: version });
