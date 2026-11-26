import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { FixtureSchema, loadFixture } from '../src/fixture.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { buildPrompt } from '../src/recall/answer.js';
import type { Classification } from '../src/recall/classify.js';
import { asksAboutForgetting, describeDeletions } from '../src/recall/deletions.js';

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

describe('questions about the past', () => {
  it('"where did I live before" offers the closed homes as candidates', async () => {
    const pune = idOf('lives_in', 'Pune');
    const blr = idOf('lives_in', 'Bengaluru');
    client.enqueue('classify', classification({ domains: ['location'] }));
    client.enqueue('answer', { sentences: [{ text: 'Bengaluru, and Pune before that.', citedIds: [blr, pune] }] });
    const result = await memory.ask('where did I live before');
    expect(result.candidates).toContain(pune);
    expect(result.candidates).toContain(blr);
    expect(result.candidates).toContain(idOf('lives_in', 'Hyderabad'));
  });

  it('"where do I live" without a past marker offers only the current home', async () => {
    client.enqueue('classify', classification({ domains: ['location'] }));
    client.enqueue('answer', { sentences: [{ text: 'Hyderabad.', citedIds: [idOf('lives_in', 'Hyderabad')] }] });
    const result = await memory.ask('where do I live');
    expect(result.candidates).not.toContain(idOf('lives_in', 'Pune'));
  });
});

describe('answers as of a session', () => {
  it('labels a fact that was current then as current, even though it has ended since', () => {
    const pune = memory.facts().find((fact) => fact.objectText === 'Pune');
    if (!pune) throw new Error('no Pune');
    const prompt = buildPrompt('where do I live', [pune], () => '', [], 10);
    expect(prompt).toContain('current as of s10, since s2');
    expect(prompt).not.toContain('(s2 to s18)');
    expect(prompt).toContain('Answer as of session 10');
    const later = buildPrompt('where do I live', [pune], () => '', [], 30);
    expect(later).toContain('ended at s18, before s30');
  });

  it('keeps the plain labels when no session is given', () => {
    const pune = memory.facts().find((fact) => fact.objectText === 'Pune');
    if (!pune) throw new Error('no Pune');
    expect(buildPrompt('q', [pune], () => '', [])).toContain('(s2 to s18)');
  });
});

describe('questions about forgetting', () => {
  it('detects the question shape', () => {
    expect(asksAboutForgetting('who did I ask you to forget')).toBe(true);
    expect(asksAboutForgetting('did I tell you to delete someone')).toBe(true);
    expect(asksAboutForgetting('have you forgotten anything')).toBe(true);
    expect(asksAboutForgetting('I forgot my umbrella at the office')).toBe(false);
    expect(asksAboutForgetting('where do I live')).toBe(false);
  });

  it('answers from the deletion log with counts and no name, and no model call', async () => {
    expect((await memory.ask('did I ask you to forget anyone')).text).toBe('No. You have not asked me to forget anything.');
    memory.forget({ kind: 'entity', name: 'Priya' }, { atSession: 48 });
    const result = await memory.ask('who did I ask you to forget');
    expect(result.text).toContain('In session 48 you asked me to forget one person');
    expect(result.text).toContain('1 fact erased');
    expect(result.text).not.toContain('Priya');
    expect(result.cost).toBe(0);
    expect(client.seen).toEqual([]);
    expect(memory.deletionsLog()).toHaveLength(1);
    expect(JSON.stringify(memory.deletionsLog())).not.toContain('Priya');
  });

  it('does not record a forget that resolved nobody', () => {
    memory.forget({ kind: 'entity', name: 'Nobody' });
    expect(memory.deletionsLog()).toEqual([]);
    expect(describeDeletions([]).text).toContain('No.');
  });
});
