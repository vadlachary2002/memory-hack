import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { FixtureSchema, loadFixture } from '../src/fixture.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { NO_INFO, stripUncited, UNKNOWN } from '../src/recall/answer.js';
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

describe('closed world', () => {
  it('abstains on an unknown role with zero answer calls', async () => {
    client.enqueue('classify', classification({ domains: ['work'], roles: ['sister'] }));
    const result = await memory.ask('what does my sister do for work');
    expect(result).toMatchObject({ text: UNKNOWN, abstained: true, cited: [], candidates: [] });
    expect(client.seen.map((call) => call.purpose)).toEqual(['classify']);
    expect(memory.cost().byPurpose.answer.calls).toBe(0);
  });

  it('abstains on an unknown name, including a forgotten one', async () => {
    memory.forget({ kind: 'entity', name: 'Priya' });
    client.enqueue('classify', classification({ domains: ['location'], names: ['Priya'] }));
    const result = await memory.ask('who did I move to Pune with');
    expect(result.text).toBe(UNKNOWN);
    expect(client.seen).toHaveLength(1);
  });
});

describe('need-to-know selection', () => {
  it('never hands the allergy to a weather question', async () => {
    const peanuts = idOf('allergic_to', 'peanuts');
    const home = idOf('lives_in', 'Hyderabad');
    client.enqueue('classify', classification({ domains: ['weather'] }));
    // A sloppy model tries to mention the allergy anyway; the citation filter drops it.
    client.enqueue('answer', {
      sentences: [
        { text: 'You are in Hyderabad, so check the local forecast.', citedIds: [home] },
        { text: 'Also avoid peanuts.', citedIds: [peanuts] },
      ],
    });
    const result = await memory.ask('will it rain tomorrow');
    expect(result.candidates).toContain(home);
    expect(result.candidates).not.toContain(peanuts);
    expect(client.seen[1]?.user).not.toContain('peanuts');
    expect(result.text).toBe('You are in Hyderabad, so check the local forecast.');
    expect(result.cited).toEqual([home]);
  });

  it('hands the allergy and the spice preference to a dinner question', async () => {
    client.enqueue('classify', classification({ domains: ['food', 'dining'] }));
    client.enqueue('answer', { sentences: [{ text: 'Try a mildly spicy curry without peanuts.', citedIds: [idOf('prefers', 'mildly spicy'), idOf('allergic_to', 'peanuts')] }] });
    const result = await memory.ask('dinner idea for tonight');
    expect(result.candidates).toContain(idOf('allergic_to', 'peanuts'));
    expect(result.candidates).toContain(idOf('prefers', 'mildly spicy'));
    expect(result.candidates).not.toContain(idOf('searched_for', 'flights to Goa'));
    expect(result.abstained).toBe(false);
  });

  it('returns the fallback when a known person has no matching fact and the model guesses', async () => {
    client.enqueue('classify', classification({ domains: ['general'], names: ['Meera'] }));
    client.enqueue('answer', { sentences: [{ text: 'She probably hikes on weekends.', citedIds: [] }] });
    const result = await memory.ask('what does Meera do on weekends');
    expect(result.text).toBe(NO_INFO);
    expect(result.cited).toEqual([]);
    expect(result.candidates).toContain(idOf('reports_to', 'Meera'));
  });

  it('returns the fallback with no answer call when nothing is selectable', async () => {
    memory.forget({ kind: 'domain', domain: 'location' });
    client.enqueue('classify', classification({ domains: ['weather'] }));
    const result = await memory.ask('will it rain');
    expect(result.text).toBe(NO_INFO);
    expect(client.seen).toHaveLength(1);
  });
});

describe('stripUncited', () => {
  it('drops sentences with no citation or with a citation outside the candidates', () => {
    const allowed = new Set([1, 2]);
    const result = stripUncited(
      { sentences: [{ text: 'A.', citedIds: [1] }, { text: 'B.', citedIds: [] }, { text: 'C.', citedIds: [1, 9] }, { text: 'D.', citedIds: [2, 1] }] },
      allowed,
    );
    expect(result).toEqual({ text: 'A. D.', cited: [1, 2] });
    expect(stripUncited({ sentences: [] }, allowed).text).toBe(NO_INFO);
  });
});
