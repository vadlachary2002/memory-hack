// Open, migrate and reset the SQLite database.

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Drop order respects foreign keys.
const TABLES = ['llm_calls', 'deletions', 'facts', 'entities', 'turns', 'sessions'];

export function openDb(path: string): Db {
  const inMemory = path === ':memory:';
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  // Overwrite freed pages with zeros so erased text does not linger in the file.
  db.pragma('secure_delete = ON');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(SCHEMA);
  rebuildCallsIfOld(db);
}

// Databases created before the screen purpose carry a narrower CHECK on calls.purpose. SQLite cannot
// alter a constraint, so the table is rebuilt once with its rows kept.
function rebuildCallsIfOld(db: Db): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'llm_calls'").get() as { sql: string } | undefined;
  if (row === undefined || row.sql.includes("'screen'")) return;
  const create = SCHEMA.match(/CREATE TABLE IF NOT EXISTS llm_calls[^;]*;/s)?.[0];
  if (create === undefined) throw new Error('llm_calls table definition not found in schema');
  db.exec('BEGIN');
  db.exec('ALTER TABLE llm_calls RENAME TO llm_calls_old');
  db.exec(create);
  db.exec('INSERT INTO llm_calls SELECT * FROM llm_calls_old');
  db.exec('DROP TABLE llm_calls_old');
  db.exec('COMMIT');
}

export function resetDb(db: Db): void {
  db.pragma('foreign_keys = OFF');
  for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.pragma('foreign_keys = ON');
  migrate(db);
}

export function inTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
