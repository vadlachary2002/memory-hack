// Sessions and raw turns. Provenance for every fact points here.

import type { Db } from './connection.js';

export type Role = 'user' | 'assistant';

export type TurnRow = {
  id: number;
  sessionIdx: number;
  idx: number;
  role: Role;
  text: string | null;
  redactedAt: number | null;
};

type RawRow = {
  id: number;
  session_idx: number;
  idx: number;
  role: string;
  text: string | null;
  redacted_at: number | null;
};

export class TurnsRepo {
  constructor(private readonly db: Db) {}

  // Idempotent: re-adding a session keeps the first started_at.
  addSession(idx: number, startedAt?: string): void {
    this.db.prepare('INSERT OR IGNORE INTO sessions (idx, started_at) VALUES (?, ?)').run(idx, startedAt ?? null);
  }

  addTurn(sessionIdx: number, idx: number, role: Role, text: string): number {
    const info = this.db
      .prepare('INSERT INTO turns (session_idx, idx, role, text) VALUES (?, ?, ?, ?)')
      .run(sessionIdx, idx, role, text);
    return Number(info.lastInsertRowid);
  }

  bySession(sessionIdx: number): TurnRow[] {
    const rows = this.db.prepare('SELECT * FROM turns WHERE session_idx = ? ORDER BY idx').all(sessionIdx) as RawRow[];
    return rows.map(toRow);
  }

  byId(id: number): TurnRow | undefined {
    const row = this.db.prepare('SELECT * FROM turns WHERE id = ?').get(id) as RawRow | undefined;
    return row ? toRow(row) : undefined;
  }

  sessions(): { idx: number; startedAt: string | null }[] {
    const rows = this.db.prepare('SELECT idx, started_at FROM sessions ORDER BY idx').all() as {
      idx: number;
      started_at: string | null;
    }[];
    return rows.map((row) => ({ idx: row.idx, startedAt: row.started_at }));
  }

  hasSession(idx: number): boolean {
    return this.db.prepare('SELECT 1 FROM sessions WHERE idx = ?').get(idx) !== undefined;
  }

  latestSession(): number | undefined {
    const row = this.db.prepare('SELECT max(idx) AS idx FROM sessions').get() as { idx: number | null };
    return row.idx ?? undefined;
  }

  all(): TurnRow[] {
    const rows = this.db.prepare('SELECT * FROM turns ORDER BY session_idx, idx').all() as RawRow[];
    return rows.map(toRow);
  }

  // Physical redaction: text nulled. Returns ids changed.
  redactByIds(ids: readonly number[], atSession: number): number[] {
    const stmt = this.db.prepare('UPDATE turns SET text = NULL, redacted_at = ? WHERE id = ? AND redacted_at IS NULL');
    const redacted: number[] = [];
    for (const id of ids) if (stmt.run(atSession, id).changes > 0) redacted.push(id);
    return redacted;
  }

  // Ids of non-redacted turns whose text contains any needle, case-insensitive.
  scanText(needles: readonly string[]): number[] {
    const found = new Set<number>();
    const stmt = this.db.prepare('SELECT id FROM turns WHERE text IS NOT NULL AND instr(lower(text), lower(?)) > 0');
    for (const needle of needles) {
      if (needle.trim() === '') continue;
      for (const row of stmt.all(needle) as { id: number }[]) found.add(row.id);
    }
    return [...found].sort((a, b) => a - b);
  }
}

function toRow(raw: RawRow): TurnRow {
  return {
    id: raw.id,
    sessionIdx: raw.session_idx,
    idx: raw.idx,
    role: raw.role as Role,
    text: raw.text,
    redactedAt: raw.redacted_at,
  };
}
