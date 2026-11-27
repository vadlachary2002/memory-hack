import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { UNKNOWN } from '../src/recall/answer.js';

let client: FakeClient;
let memory: Memory;

function candidate(overrides: Record<string, unknown>): Record<string, unknown> {
  return { turnIndex: 1, about: 'me', attrKey: null, objectIsEntity: false, entityType: null, aliases: [], domains: [], ended: false, ...overrides };
}

beforeEach(async () => {
  client = new FakeClient().enqueue('extract', {
    facts: [
      candidate({ predicate: 'sibling_of', object: 'Kiran', quote: 'My brother Kiran', objectIsEntity: true, entityType: 'person', domains: ['family'] }),
      candidate({ about: 'Kiran', predicate: 'works_at', object: 'TCS', quote: 'Kiran works at TCS', domains: ['work', 'family'] }),
    ],
  });
  memory = new Memory({ dbPath: ':memory:', llm: client });
  await memory.ingest({ index: 1, turns: [{ role: 'user', text: 'My brother Kiran works at TCS in Hyderabad.' }] });
});

describe('about never creates entities', () => {
  it('falls back to the user for "Priya and I", "we", "my manager" and strangers, and leaves no new rows', async () => {
    const client = new FakeClient().enqueue('extract', {
      facts: [
        candidate({ about: 'Priya and I', predicate: 'adopted_pet', object: 'Bruno', quote: 'Priya and I adopted Bruno', objectIsEntity: true, entityType: 'pet' }),
        candidate({ about: 'we', predicate: 'lives_in', object: 'Pune', quote: 'we moved to Pune' }),
        candidate({ about: 'Rahul', predicate: 'works_at', object: 'Zoho', quote: 'Rahul works at Zoho' }),
      ],
    });
    const fresh = new Memory({ dbPath: ':memory:', llm: client });
    await fresh.ingest({ index: 1, turns: [{ role: 'user', text: 'Priya and I adopted Bruno. we moved to Pune. Rahul works at Zoho' }] });
    const user = fresh.facts().find((f) => f.predicate === 'lives_in')?.subjectEntityId;
    expect(fresh.facts().every((f) => f.subjectEntityId === user)).toBe(true);
    const names = (fresh.rawDb().prepare('SELECT canonical_name FROM entities').all() as { canonical_name: string | null }[]).map((r) => r.canonical_name);
    expect(names).toEqual(['user', 'Bruno']);
  });
});

describe('facts about people in the user\'s life', () => {
  it('stores the employer under the brother, not the user, and renders it with his name', () => {
    const facts = memory.facts();
    const job = facts.find((fact) => fact.predicate === 'works_at');
    const sibling = facts.find((fact) => fact.predicate === 'sibling_of');
    expect(job?.subjectEntityId).toBe(sibling?.objectEntityId);
    expect(job?.subjectEntityId).not.toBe(sibling?.subjectEntityId);
    expect(memory.summarise()).toContain('Kiran: works at TCS');
    expect(memory.summarise()).toContain('sibling Kiran');
  });

  it('"what does my brother do" selects the brother\'s own facts', async () => {
    const job = memory.facts().find((fact) => fact.predicate === 'works_at');
    client.enqueue('classify', { domains: ['work', 'family'], names: [], roles: ['brother'], timeAnchor: null });
    client.enqueue('answer', { sentences: [{ text: 'Kiran works at TCS.', citedIds: [job?.id ?? -1] }] });
    const result = await memory.ask('what does my brother do');
    expect(result.candidates).toContain(job?.id);
    expect(result.text).toBe('Kiran works at TCS.');
  });

  it('"where do I work" does not pick up the brother\'s employer', async () => {
    const job = memory.facts().find((fact) => fact.predicate === 'works_at');
    client.enqueue('classify', { domains: ['work'], names: [], roles: [], timeAnchor: null });
    // The honest model sees the line is about Kiran and returns nothing about the user.
    client.enqueue('answer', { sentences: [] });
    const result = await memory.ask('where do I work');
    // Domain selection still offers it, but it is labelled with Kiran's name for the answer step.
    expect(result.candidates).toContain(job?.id);
    expect(client.seen.at(-1)?.user).toContain('Kiran: works at TCS');
    expect(result.text).toBe("I don't have that.");
  });

  it('forgetting the brother erases his facts and the question abstains', async () => {
    const report = memory.forget({ kind: 'entity', name: 'my brother' });
    expect(report.erasedFacts).toHaveLength(2);
    expect(memory.audit('Kiran').clean).toBe(true);
    client.enqueue('classify', { domains: ['work', 'family'], names: [], roles: ['brother'], timeAnchor: null });
    expect((await memory.ask('what does my brother do')).text).toBe(UNKNOWN);
  });
});
