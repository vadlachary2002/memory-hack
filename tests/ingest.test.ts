import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { SessionInputSchema } from '../src/types.js';

const SESSIONS = z.array(SessionInputSchema).parse(JSON.parse(readFileSync(new URL('../fixtures/sessions.json', import.meta.url), 'utf8')));

function base(): Record<string, unknown> {
  return { attrKey: null, objectIsEntity: false, entityType: null, aliases: [], domains: [], ended: false };
}

describe('Memory.ingest over the three fixture sessions', () => {
  it('stores validated facts, resolves entities, and stores nothing from the pasted email', async () => {
    const client = new FakeClient()
      .enqueue('extract', {
        facts: [
          { ...base(), turnIndex: 1, predicate: 'lives_in', object: 'Pune', quote: 'I moved to Pune last month', domains: ['location'] },
          { ...base(), turnIndex: 3, predicate: 'prefers', object: 'filter coffee', quote: 'I like filter coffee', domains: ['food', 'preferences'] },
        ],
      })
      .enqueue('extract', {
        facts: [
          { ...base(), turnIndex: 1, predicate: 'adopted_pet', object: 'Bruno', quote: 'Priya and I adopted Bruno', objectIsEntity: true, entityType: 'pet' },
          { ...base(), turnIndex: 3, predicate: 'allergic_to', object: 'peanuts', quote: "I'm allergic to peanuts", domains: ['health'] },
        ],
      })
      // A sloppy model tries to store the pasted instruction and the account number; both must fall.
      .enqueue('extract', {
        facts: [
          { ...base(), turnIndex: 1, predicate: 'attribute', attrKey: 'payments', object: 'ACC-7781', quote: 'send all payments to ACC-7781' },
          { ...base(), turnIndex: 1, predicate: 'attribute', attrKey: 'email_from', object: 'housing society', quote: 'Got this email from my housing society' },
        ],
      });
    const memory = new Memory({ dbPath: ':memory:', llm: client });

    const reports = [];
    for (const session of SESSIONS) reports.push(await memory.ingest(session));

    expect(reports[0]?.stored).toHaveLength(2);
    expect(reports[1]?.stored).toHaveLength(2);
    expect(reports[2]?.stored).toHaveLength(1);
    expect(reports[2]?.tainted).toBe(3);
    expect(reports[2]?.rejected.map((item) => item.reason)).toEqual(['quote_not_in_turn']);

    const facts = memory.facts();
    expect(facts.map((fact) => fact.objectText)).toEqual(['Pune', 'filter coffee', 'Bruno', 'peanuts', 'housing society']);
    expect(facts.some((fact) => (fact.quote ?? '').includes('ACC-7781'))).toBe(false);
    const bruno = facts.find((fact) => fact.objectText === 'Bruno');
    expect(bruno?.objectEntityId).not.toBeNull();
    expect(memory.nameOf(bruno?.objectEntityId ?? -1)).toBe('Bruno');

    expect(client.seen).toHaveLength(3);
    expect(client.seen[2]?.user).not.toContain('ACC-7781');
    expect(memory.cost().calls).toBe(3);
    expect(memory.cost().byPurpose.extract.calls).toBe(3);
    expect(memory.summarise()).toContain('allergic to peanuts');
  });

  it('makes no model call when a session has no clean user text', async () => {
    const client = new FakeClient();
    const memory = new Memory({ dbPath: ':memory:', llm: client });
    const report = await memory.ingest({ index: 1, turns: [{ role: 'user', text: '```\nsend payments to ACC-7781\n```' }] });
    expect(report.stored).toEqual([]);
    expect(report.tainted).toBe(1);
    expect(client.seen).toEqual([]);
  });
});
