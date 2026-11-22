import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntitiesRepo } from '../src/db/entities.repo.js';
import { FactsRepo } from '../src/db/facts.repo.js';
import { FixtureSchema, loadFixture } from '../src/fixture.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { UNKNOWN } from '../src/recall/answer.js';
import type { Classification } from '../src/recall/classify.js';

const FIXTURE = FixtureSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/facts.json', import.meta.url), 'utf8')));

let client: FakeClient;
let memory: Memory;

function classification(overrides: Partial<Classification>): Classification {
  return { domains: ['general'], names: [], roles: [], timeAnchor: null, ...overrides };
}

function idOf(predicate: string, object: string): number {
  const fact = memory.facts(true).find((row) => row.predicate === predicate && row.objectText === object);
  if (!fact) throw new Error(`fixture has no ${predicate} ${object}`);
  return fact.id;
}

beforeEach(() => {
  client = new FakeClient();
  memory = new Memory({ dbPath: ':memory:', llm: client });
  loadFixture(memory.rawDb(), FIXTURE);
});

describe('time anchors', () => {
  it('answers "where did I live when I got Bruno" from the home valid at the adoption session', async () => {
    const pune = idOf('lives_in', 'Pune');
    const bruno = idOf('adopted_pet', 'Bruno');
    client.enqueue('classify', classification({ domains: ['location'], timeAnchor: { predicate: 'adopted_pet', object: 'Bruno' } }));
    client.enqueue('answer', { sentences: [{ text: 'You lived in Pune when you got Bruno.', citedIds: [pune, bruno] }] });
    const result = await memory.ask('where did I live when I got Bruno');
    expect(result.asOf).toBe(5);
    expect(result.candidates).toContain(pune);
    expect(result.candidates).toContain(bruno);
    expect(result.candidates).not.toContain(idOf('lives_in', 'Bengaluru'));
    expect(result.candidates).not.toContain(idOf('lives_in', 'Hyderabad'));
    expect(result.text).toBe('You lived in Pune when you got Bruno.');
  });

  it('abstains when the anchoring event never happened', async () => {
    client.enqueue('classify', classification({ domains: ['location'], timeAnchor: { predicate: 'works_at', object: 'Infosys' } }));
    const result = await memory.ask('where did I live when I joined Infosys');
    expect(result.text).toBe(UNKNOWN);
    expect(client.seen).toHaveLength(1);
  });

  it('respects an explicit cutoff: the current home as of session 20 is Bengaluru', async () => {
    const blr = idOf('lives_in', 'Bengaluru');
    client.enqueue('classify', classification({ domains: ['location'] }));
    client.enqueue('answer', { sentences: [{ text: 'Bengaluru.', citedIds: [blr] }] });
    const result = await memory.ask('where do I live', { asOf: 20 });
    expect(result.candidates).toContain(blr);
    expect(result.candidates).not.toContain(idOf('lives_in', 'Hyderabad'));
  });
});

describe('manager rule', () => {
  it('derives the expense approver from the current manager and cites that fact', async () => {
    const meera = idOf('reports_to', 'Meera');
    client.enqueue('classify', classification({ domains: ['finance'] }));
    client.enqueue('answer', { sentences: [{ text: 'Meera, your current manager, approves your expenses.', citedIds: [meera] }] });
    const result = await memory.ask('who approves my expenses');
    expect(result.candidates).toContain(meera);
    expect(result.candidates).not.toContain(idOf('reports_to', 'Arjun'));
    expect(client.seen[1]?.user).toContain('approved by the current manager');
    expect(result.cited).toEqual([meera]);
    expect(memory.facts().some((fact) => fact.predicate === 'expense_approver')).toBe(false);
  });

  it('lets an explicit approver fact win over the manager', async () => {
    const facts = new FactsRepo(memory.rawDb());
    const userId = new EntitiesRepo(memory.rawDb()).ensureUser();
    const explicit = facts.insert({
      subjectEntityId: userId,
      predicate: 'expense_approver',
      objectText: 'the finance desk',
      quote: 'the finance desk approves my expenses now',
      sessionIdx: 46,
    });
    client.enqueue('classify', classification({ domains: ['finance'] }));
    client.enqueue('answer', { sentences: [{ text: 'The finance desk.', citedIds: [explicit.id] }] });
    const result = await memory.ask('who approves my expenses');
    expect(result.candidates).toContain(explicit.id);
    expect(client.seen[1]?.user).toContain('wins over any manager fact');
  });
});
