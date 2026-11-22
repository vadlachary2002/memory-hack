// The fact ledger. Supersession and validity are decided here, in code.

import type { Db } from './connection.js';
import { PREDICATES, tierOf, type Domain, type Predicate, type Tier } from '../vocab.js';

export type FactRow = {
  id: number;
  subjectEntityId: number;
  predicate: Predicate;
  attrKey: string | null;
  objectText: string | null;
  objectEntityId: number | null;
  quote: string | null;
  sourceTurnId: number | null;
  sessionIdx: number;
  validFrom: number;
  validTo: number | null;
  recordedAt: string;
  domains: Domain[];
  tier: Tier;
  erasedAt: number | null;
};

export type NewFact = {
  subjectEntityId: number;
  predicate: Predicate;
  attrKey?: string;
  objectText: string;
  objectEntityId?: number;
  quote: string;
  sourceTurnId?: number;
  sessionIdx: number;
  // Defaults to sessionIdx.
  validFrom?: number;
  // Defaults to the predicate's domains.
  domains?: readonly Domain[];
};

export type InsertResult = { id: number; superseded: number[]; noop: boolean };

export type ValueMatch = { objectText?: string; objectEntityId?: number; attrKey?: string };

type RawRow = {
  id: number;
  subject_entity_id: number;
  predicate: string;
  attr_key: string | null;
  object_text: string | null;
  object_entity_id: number | null;
  quote: string | null;
  source_turn_id: number | null;
  session_idx: number;
  valid_from: number;
  valid_to: number | null;
  recorded_at: string;
  domains_json: string;
  tier: string;
  erased_at: number | null;
};

const INSERT = `INSERT INTO facts (subject_entity_id, predicate, attr_key, object_text, object_entity_id, quote,
  source_turn_id, session_idx, valid_from, domains_json, tier)
  VALUES (@subjectEntityId, @predicate, @attrKey, @objectText, @objectEntityId, @quote,
  @sourceTurnId, @sessionIdx, @validFrom, @domainsJson, @tier)`;

const SELECT = 'SELECT * FROM facts';

export class FactsRepo {
  constructor(private readonly db: Db) {}

  // Insert a fact. Functional predicates close every open row with the same subject, predicate
  // and attr_key. An identical open value is a no-op for every predicate, so repetition never duplicates.
  insert(fact: NewFact): InsertResult {
    const spec = PREDICATES[fact.predicate];
    const validFrom = fact.validFrom ?? fact.sessionIdx;
    const domains = fact.domains ?? spec.domains;
    const run = this.db.transaction((): InsertResult => {
      const open = this.currentFor(fact.subjectEntityId, fact.predicate, fact.attrKey);
      const same = open.find((row) => sameValue(row, fact));
      if (same) return { id: same.id, superseded: [], noop: true };
      const superseded: number[] = [];
      if (spec.functional) {
        for (const row of open) {
          this.close(row.id, validFrom);
          superseded.push(row.id);
        }
      }
      const info = this.db.prepare(INSERT).run({
        subjectEntityId: fact.subjectEntityId,
        predicate: fact.predicate,
        attrKey: fact.attrKey ?? null,
        objectText: fact.objectText,
        objectEntityId: fact.objectEntityId ?? null,
        quote: fact.quote,
        sourceTurnId: fact.sourceTurnId ?? null,
        sessionIdx: fact.sessionIdx,
        validFrom,
        domainsJson: JSON.stringify([...domains]),
        tier: tierOf(fact.predicate),
      });
      return { id: Number(info.lastInsertRowid), superseded, noop: false };
    });
    return run();
  }

  // Close one fact at a session. Returns false if it was already closed or does not exist.
  close(id: number, atSession: number): boolean {
    const info = this.db
      .prepare('UPDATE facts SET valid_to = ? WHERE id = ? AND valid_to IS NULL AND erased_at IS NULL')
      .run(atSession, id);
    return info.changes > 0;
  }

  // Close open facts matching a value, for "ended" statements. Returns the ids closed.
  closeOpen(subjectEntityId: number, predicate: Predicate, atSession: number, match: ValueMatch = {}): number[] {
    const closed: number[] = [];
    for (const row of this.currentFor(subjectEntityId, predicate, match.attrKey)) {
      if (!matches(row, match)) continue;
      if (this.close(row.id, atSession)) closed.push(row.id);
    }
    return closed;
  }

  // Open, non-erased rows for a subject and predicate (and attr_key when given).
  currentFor(subjectEntityId: number, predicate: Predicate, attrKey?: string): FactRow[] {
    const rows = this.db
      .prepare(
        `${SELECT} WHERE subject_entity_id = ? AND predicate = ? AND valid_to IS NULL AND erased_at IS NULL
         AND (@attrKey IS NULL OR attr_key = @attrKey) ORDER BY id`,
      )
      .all(subjectEntityId, predicate, { attrKey: attrKey ?? null }) as RawRow[];
    return rows.map(toRow);
  }

  // Rows whose validity interval covers the session.
  validAt(subjectEntityId: number, predicate: Predicate, session: number, attrKey?: string): FactRow[] {
    const rows = this.db
      .prepare(
        `${SELECT} WHERE subject_entity_id = ? AND predicate = ? AND erased_at IS NULL
         AND valid_from <= @session AND (valid_to IS NULL OR valid_to > @session)
         AND (@attrKey IS NULL OR attr_key = @attrKey) ORDER BY id`,
      )
      .all(subjectEntityId, predicate, { session, attrKey: attrKey ?? null }) as RawRow[];
    return rows.map(toRow);
  }

  // Durable, non-erased rows valid at asOf (open rows when asOf is omitted) tagged with any of the domains.
  byDomains(domains: readonly Domain[], asOf?: number): FactRow[] {
    if (domains.length === 0) return [];
    const placeholders = domains.map(() => '?').join(', ');
    const validity = asOf === undefined ? 'valid_to IS NULL' : 'valid_from <= @asOf AND (valid_to IS NULL OR valid_to > @asOf)';
    const rows = this.db
      .prepare(
        `${SELECT} WHERE tier = 'durable' AND erased_at IS NULL AND ${validity}
         AND EXISTS (SELECT 1 FROM json_each(facts.domains_json) WHERE json_each.value IN (${placeholders}))
         ORDER BY valid_from DESC, id DESC`,
      )
      .all(...domains, { asOf: asOf ?? null }) as RawRow[];
    return rows.map(toRow);
  }

  // Rows where the entity is the subject or the object.
  byEntity(entityId: number, includeErased = false): FactRow[] {
    const erased = includeErased ? '' : 'AND erased_at IS NULL';
    const rows = this.db
      .prepare(`${SELECT} WHERE (subject_entity_id = ? OR object_entity_id = ?) ${erased} ORDER BY id`)
      .all(entityId, entityId) as RawRow[];
    return rows.map(toRow);
  }

  bySession(sessionIdx: number): FactRow[] {
    const rows = this.db.prepare(`${SELECT} WHERE session_idx = ? ORDER BY id`).all(sessionIdx) as RawRow[];
    return rows.map(toRow);
  }

  byId(id: number): FactRow | undefined {
    const row = this.db.prepare(`${SELECT} WHERE id = ?`).get(id) as RawRow | undefined;
    return row ? toRow(row) : undefined;
  }

  all(includeErased = false): FactRow[] {
    const erased = includeErased ? '' : 'WHERE erased_at IS NULL';
    const rows = this.db.prepare(`${SELECT} ${erased} ORDER BY id`).all() as RawRow[];
    return rows.map(toRow);
  }

  // Ids of non-erased rows whose object or quote contains any needle, case-insensitive.
  scanText(needles: readonly string[]): number[] {
    const found = new Set<number>();
    const stmt = this.db.prepare(
      `SELECT id FROM facts WHERE erased_at IS NULL
       AND (instr(lower(coalesce(object_text, '')), lower(?)) > 0 OR instr(lower(coalesce(quote, '')), lower(?)) > 0)`,
    );
    for (const needle of needles) {
      if (needle.trim() === '') continue;
      for (const row of stmt.all(needle, needle) as { id: number }[]) found.add(row.id);
    }
    return [...found].sort((a, b) => a - b);
  }
}

function sameValue(row: FactRow, fact: NewFact): boolean {
  if ((row.attrKey ?? null) !== (fact.attrKey ?? null)) return false;
  if (row.objectEntityId !== null && fact.objectEntityId !== undefined) return row.objectEntityId === fact.objectEntityId;
  return normalise(row.objectText) === normalise(fact.objectText);
}

function matches(row: FactRow, match: ValueMatch): boolean {
  if (match.objectEntityId !== undefined && row.objectEntityId !== match.objectEntityId) return false;
  if (match.objectText !== undefined && normalise(row.objectText) !== normalise(match.objectText)) return false;
  return true;
}

function normalise(text: string | null): string {
  return (text ?? '').trim().toLowerCase();
}

function toRow(raw: RawRow): FactRow {
  return {
    id: raw.id,
    subjectEntityId: raw.subject_entity_id,
    predicate: raw.predicate as Predicate,
    attrKey: raw.attr_key,
    objectText: raw.object_text,
    objectEntityId: raw.object_entity_id,
    quote: raw.quote,
    sourceTurnId: raw.source_turn_id,
    sessionIdx: raw.session_idx,
    validFrom: raw.valid_from,
    validTo: raw.valid_to,
    recordedAt: raw.recorded_at,
    domains: JSON.parse(raw.domains_json) as Domain[],
    tier: raw.tier as Tier,
    erasedAt: raw.erased_at,
  };
}
