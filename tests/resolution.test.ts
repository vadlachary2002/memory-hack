import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntitiesRepo } from '../src/db/entities.repo.js';
import { FixtureSchema, loadFixture } from '../src/fixture.js';
import { markFormer, resolveObject } from '../src/ingest/resolve.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { UNKNOWN } from '../src/recall/answer.js';
import type { Classification } from '../src/recall/classify.js';
import { isGenericObject, isRoleWord, normaliseRef, roleFor } from '../src/roles.js';

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

describe('lexicon', () => {
  it('maps everyday words to roles and strips articles and possessives', () => {
    expect(roleFor('that dog')).toBe('dog');
    expect(roleFor('my puppy')).toBe('dog');
    expect(roleFor('my pet')).toBe('pet');
    expect(roleFor('the boss')).toBe('manager');
    expect(roleFor("my old boss")).toBe('former manager');
    expect(roleFor('fiancee')).toBe('partner');
    expect(normaliseRef("Priya's")).toBe('priya');
    expect(isRoleWord('dog')).toBe(true);
    expect(isRoleWord('Priya')).toBe(false);
  });

  it('knows generic words per predicate', () => {
    expect(isGenericObject('adopted_pet', 'that dog')).toBe(true);
    expect(isGenericObject('adopted_pet', 'Bruno')).toBe(false);
    expect(isGenericObject('lives_in', 'the city')).toBe(true);
    expect(isGenericObject('partner_of', 'my girlfriend')).toBe(true);
    expect(isGenericObject('works_at', '')).toBe(true);
  });
});

describe('anchors with generic words', () => {
  it('"when we got that dog" anchors on the adoption and selects Pune', async () => {
    const pune = idOf('lives_in', 'Pune');
    client.enqueue('classify', classification({ domains: ['location', 'pets'], timeAnchor: { predicate: 'adopted_pet', object: 'that dog' } }));
    client.enqueue('answer', { sentences: [{ text: 'Pune.', citedIds: [pune] }] });
    const result = await memory.ask('where did I live when we got that dog');
    expect(result.asOf).toBe(5);
    expect(result.candidates).toContain(pune);
    expect(result.candidates).not.toContain(idOf('lives_in', 'Hyderabad'));
  });

  it('"when I moved" with no object anchors on the first move', async () => {
    client.enqueue('classify', classification({ domains: ['work'], timeAnchor: { predicate: 'lives_in', object: '' } }));
    client.enqueue('answer', { sentences: [] });
    const result = await memory.ask('what was my job when I moved');
    expect(result.asOf).toBe(2);
  });

  it('a generic word still abstains when no fact of that kind exists', async () => {
    client.enqueue('classify', classification({ domains: ['location'], timeAnchor: { predicate: 'works_at', object: 'the job' } }));
    const result = await memory.ask('where did I live when I got the job');
    expect(result.text).toBe(UNKNOWN);
    expect(client.seen).toHaveLength(1);
  });
});

describe('names that are really category words', () => {
  it('resolves "dog" given as a name to the pet entity', async () => {
    const bruno = idOf('adopted_pet', 'Bruno');
    client.enqueue('classify', classification({ domains: ['pets'], names: ['dog'] }));
    client.enqueue('answer', { sentences: [{ text: 'Bruno, a beagle.', citedIds: [bruno] }] });
    const result = await memory.ask('what is my dog called');
    expect(result.candidates).toContain(bruno);
    expect(result.abstained).toBe(false);
  });

  it('resolves a possessive name', async () => {
    client.enqueue('classify', classification({ domains: ['work'], names: ["Meera's"] }));
    client.enqueue('answer', { sentences: [{ text: 'Meera is your manager.', citedIds: [idOf('reports_to', 'Meera')] }] });
    const result = await memory.ask("what is Meera's role");
    expect(result.abstained).toBe(false);
  });

  it('still abstains on an unknown real name and on a category with no entity', async () => {
    client.enqueue('classify', classification({ domains: ['general'], names: ['Rahul'] }));
    expect((await memory.ask('who is Rahul')).text).toBe(UNKNOWN);
    client.enqueue('classify', classification({ domains: ['family'], names: ['sister'] }));
    expect((await memory.ask('who is my sister')).text).toBe(UNKNOWN);
    expect(client.seen).toHaveLength(2);
  });
});

describe('roles with only former holders', () => {
  it('"who is my partner" after the breakup hands the closed fact to the answer step', async () => {
    const priya = idOf('partner_of', 'Priya');
    client.enqueue('classify', classification({ domains: ['relationships'], roles: ['partner'] }));
    client.enqueue('answer', { sentences: [{ text: 'You are not with anyone now; you were with Priya until recently.', citedIds: [priya] }] });
    const result = await memory.ask('who is my partner');
    expect(result.abstained).toBe(false);
    expect(result.candidates).toContain(priya);
  });

  it('a role nobody ever held still abstains', async () => {
    client.enqueue('classify', classification({ domains: ['family'], roles: ['brother'] }));
    expect((await memory.ask('who is my brother')).text).toBe(UNKNOWN);
    expect(client.seen).toHaveLength(1);
  });
});

describe('specific kinds within a category', () => {
  it('"my dog" resolves Bruno but "my cat" abstains, and "my pet" reaches any pet', async () => {
    const bruno = idOf('adopted_pet', 'Bruno');
    client.enqueue('classify', classification({ domains: ['pets'], roles: ['dog'] }));
    client.enqueue('answer', { sentences: [{ text: 'Bruno.', citedIds: [bruno] }] });
    expect((await memory.ask('what is my dog called')).candidates).toContain(bruno);

    client.enqueue('classify', classification({ domains: ['pets'], roles: ['cat'] }));
    expect((await memory.ask('what is my cat called')).text).toBe(UNKNOWN);

    client.enqueue('classify', classification({ domains: ['pets'], roles: ['pet'] }));
    client.enqueue('answer', { sentences: [{ text: 'Bruno.', citedIds: [bruno] }] });
    expect((await memory.ask('what is my pet called')).candidates).toContain(bruno);
  });

  it('entities pick up specific roles from the words around them, and keep them when the relationship ends', () => {
    const entities = new EntitiesRepo(memory.rawDb());
    const id = resolveObject(
      entities,
      { turnIndex: 1, predicate: 'partner_of', attrKey: null, object: 'Neha', quote: 'Neha is my girlfriend', objectIsEntity: true, entityType: 'person', aliases: [], domains: [], ended: false },
      1,
      'Neha is my girlfriend, we met in Pune.',
    );
    expect(entities.byId(id ?? -1)?.roles).toEqual(['partner', 'girlfriend']);
    markFormer(entities, id ?? -1, 'partner_of');
    expect(entities.byId(id ?? -1)?.roles).toEqual(['former partner', 'former girlfriend']);
    expect(entities.allByRole('former girlfriend').map((row) => row.id)).toEqual([id]);
    // "ex-girlfriend" maps to the category, so it also finds the fixture's former partner Priya.
    expect(entities.allByRole(roleFor('ex-girlfriend')).map((row) => row.id)).toContain(id);
  });

  it('"who was my old boss" includes the former manager alongside the current one', async () => {
    const arjun = idOf('reports_to', 'Arjun');
    const meera = idOf('reports_to', 'Meera');
    client.enqueue('classify', classification({ domains: ['work'], roles: ['boss'] }));
    client.enqueue('answer', { sentences: [{ text: 'Arjun, before Meera.', citedIds: [arjun] }] });
    const result = await memory.ask('who was my old boss');
    expect(result.candidates).toContain(arjun);
    expect(result.candidates).toContain(meera);

    client.enqueue('classify', classification({ domains: ['work'], roles: ['boss'] }));
    client.enqueue('answer', { sentences: [{ text: 'Meera.', citedIds: [meera] }] });
    const now = await memory.ask('who is my boss');
    expect(now.candidates).toContain(meera);
    expect(now.candidates).not.toContain(arjun);
  });
});

describe('forget with category words', () => {
  it('"forget my puppy" resolves the pet and erases the adoption fact', () => {
    const bruno = idOf('adopted_pet', 'Bruno');
    const report = memory.forget({ kind: 'entity', name: 'my puppy' });
    expect(report.entityIds).toHaveLength(1);
    expect(report.erasedFacts).toEqual([bruno]);
    expect(memory.audit('Bruno').clean).toBe(true);
  });
});
