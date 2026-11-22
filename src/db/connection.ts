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
  if (!inMemory) db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(SCHEMA);
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
