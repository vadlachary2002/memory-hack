// Long paragraphs: speech passes on its shape, unbroken text is screened, the screen can only release.

import { describe, expect, it } from 'vitest';
import { release } from '../src/ingest/screen.js';
import { readsAsSpeech, splitTurn, storableText, taintReason } from '../src/ingest/taint.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';

const SPEECH = Array.from({ length: 12 }, (_, i) => `So the thing is I moved to Pune last month and the flat is fine, point ${i + 1}.`).join(' ');
const BLOB = 'id=7731 status=ok region=ap-south-1 '.repeat(14).trim();
const MIXED = `Quick update from me before the paste. ${BLOB}`;

function candidate(overrides: Record<string, unknown>) {
  return { about: 'me', attrKey: null, objectIsEntity: false, entityType: null, aliases: [], domains: ['location'], ended: false, turnIndex: 1, ...overrides };
}

describe('length is a suspicion, not a verdict', () => {
  it('keeps a long paragraph of ordinary sentences as clean speech', () => {
    expect(SPEECH.length).toBeGreaterThan(400);
    expect(readsAsSpeech(SPEECH)).toBe(true);
    expect(taintReason(SPEECH)).toBeUndefined();
    expect(splitTurn(1, SPEECH).clean).toHaveLength(1);
  });

  it('holds back a long run with no sentence breaks', () => {
    expect(readsAsSpeech(BLOB)).toBe(false);
    expect(taintReason(BLOB)).toBe('too_long');
    expect(storableText(BLOB)).toBe('[pasted content removed: too_long]');
  });
});

describe('release', () => {
  const suspects = [{ turnIndex: 1, text: MIXED }];
  it('fails closed: no verdict, pasted, or own words not in the paragraph release nothing', () => {
    expect(release(suspects, [])).toEqual([]);
    expect(release(suspects, [{ index: 1, kind: 'pasted', ownText: null }])).toEqual([]);
    expect(release(suspects, [{ index: 1, kind: 'mixed', ownText: 'words that are not there' }])).toEqual([]);
    expect(release(suspects, [{ index: 2, kind: 'own', ownText: null }])).toEqual([]);
  });

  it('releases the whole paragraph for own, and only the verbatim own words for mixed', () => {
    expect(release(suspects, [{ index: 1, kind: 'own', ownText: null }])[0]?.text).toBe(MIXED);
    expect(release(suspects, [{ index: 1, kind: 'mixed', ownText: 'Quick update from me before the paste.' }])[0]?.text).toBe('Quick update from me before the paste.');
  });
});

describe('ingest with the screen step', () => {
  it('a suspect paragraph with no screen verdict is tainted and never extracted', async () => {
    const client = new FakeClient();
    const memory = new Memory({ dbPath: ':memory:', llm: client });
    const report = await memory.ingest({ index: 1, turns: [{ role: 'user', text: BLOB }] });
    expect(report.tainted).toBe(1);
    expect(report.stored).toHaveLength(0);
    expect(client.seen.map((call) => call.purpose)).toEqual(['screen']);
    expect(memory.audit('7731').clean).toBe(true);
  });

  it('a released mixed paragraph is extracted from and stored in the transcript as the own words only', async () => {
    const client = new FakeClient()
      .enqueue('screen', { verdicts: [{ index: 1, kind: 'mixed', ownText: 'Quick update from me before the paste.' }] })
      .enqueue('extract', { facts: [candidate({ predicate: 'attribute', attrKey: 'note', object: 'Quick update from me', quote: 'Quick update from me before the paste.' })] });
    const memory = new Memory({ dbPath: ':memory:', llm: client });
    const report = await memory.ingest({ index: 1, turns: [{ role: 'user', text: MIXED }] });
    expect(report.tainted).toBe(0);
    expect(report.stored).toHaveLength(1);
    expect(client.seen.map((call) => call.purpose)).toEqual(['screen', 'extract']);
    expect(client.seen[1]?.user).not.toContain('ap-south-1');
    expect(memory.audit('ap-south-1').clean).toBe(true);
    expect(report.cost).toBeGreaterThan(0);
  });

  it('long speech needs no screen call at all', async () => {
    const client = new FakeClient().enqueue('extract', { facts: [candidate({ predicate: 'lives_in', object: 'Pune', quote: 'I moved to Pune last month' })] });
    const memory = new Memory({ dbPath: ':memory:', llm: client });
    const report = await memory.ingest({ index: 1, turns: [{ role: 'user', text: SPEECH }] });
    expect(client.seen.map((call) => call.purpose)).toEqual(['extract']);
    expect(report.stored).toHaveLength(1);
  });
});

describe('old databases', () => {
  it('rebuilds the calls table so the screen purpose can be recorded', async () => {
    const { openDb } = await import('../src/db/connection.js');
    const db = openDb(':memory:');
    db.exec(`DROP TABLE llm_calls; CREATE TABLE llm_calls (id INTEGER PRIMARY KEY, purpose TEXT NOT NULL CHECK (purpose IN ('extract', 'classify', 'answer')), model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL, session_idx INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    db.exec("INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cost_usd, session_idx) VALUES ('extract', 'fake', 1, 1, 0.01, 1)");
    const { migrate } = await import('../src/db/connection.js');
    migrate(db);
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'llm_calls'").get() as { sql: string }).sql;
    expect(sql).toContain("'screen'");
    expect((db.prepare('SELECT count(*) AS n FROM llm_calls').get() as { n: number }).n).toBe(1);
    db.exec("INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cost_usd, session_idx) VALUES ('screen', 'fake', 1, 1, 0.01, 1)");
  });
});
