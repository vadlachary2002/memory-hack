import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntitiesRepo } from '../src/db/entities.repo.js';
import { containsName, redactNames } from '../src/forget/names.js';
import { FixtureSchema, loadFixture } from '../src/fixture.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';

const FIXTURE = FixtureSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/facts.json', import.meta.url), 'utf8')));

let memory: Memory;

beforeEach(() => {
  memory = new Memory({ dbPath: ':memory:', llm: new FakeClient() });
  loadFixture(memory.rawDb(), FIXTURE);
});

describe('name matching', () => {
  it('matches whole words only, case-insensitive', () => {
    expect(containsName('Priya and I adopted Bruno', ['priya'])).toBe(true);
    expect(containsName('the price was fine', ['Pri'])).toBe(false);
    expect(containsName('call Pri tonight', ['Pri'])).toBe(true);
    expect(redactNames('Priya and I adopted Bruno', ['Priya'])).toBe('[redacted] and I adopted Bruno');
  });
});

describe('forget my ex', () => {
  it('resolves through the closed partner_of fact, erases, strips, redacts, and audits clean', () => {
    const before = memory.audit('Priya');
    expect(before.clean).toBe(false);

    const report = memory.forget({ kind: 'entity', name: 'my ex' }, { atSession: 48 });

    expect(report.entityIds).toHaveLength(1);
    expect(report.erasedFacts).toHaveLength(1);
    expect(report.strippedFacts).toHaveLength(1);
    expect(report.redactedTurns.length).toBeGreaterThanOrEqual(3);
    expect(report.probes.every((probe) => probe.passed)).toBe(true);
    expect(report.scanClean).toBe(true);

    const facts = memory.facts(true);
    const partner = facts.find((fact) => fact.predicate === 'partner_of');
    expect(partner?.erasedAt).toBe(48);
    expect(partner?.objectText).toBeNull();
    expect(partner?.quote).toBeNull();
    expect(partner?.objectEntityId).toBeNull();

    const bruno = facts.find((fact) => fact.predicate === 'adopted_pet');
    expect(bruno?.erasedAt).toBeNull();
    expect(bruno?.objectText).toBe('Bruno');
    expect(bruno?.quote).toBe('[redacted] and I adopted Bruno');

    expect(memory.summarise()).not.toContain('Priya');
    expect(memory.audit('Priya').clean).toBe(true);
    expect(memory.audit('Pri').clean).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Priya');
  });

  it('is idempotent: a second forget finds nothing and stays clean', () => {
    memory.forget({ kind: 'entity', name: 'Priya' });
    const again = memory.forget({ kind: 'entity', name: 'Priya' });
    expect(again.entityIds).toEqual([]);
    expect(again.scanClean).toBe(true);
  });
});

describe('forget by name and relation words', () => {
  it('forgets a manager by name and leaves the current manager alone', () => {
    const report = memory.forget({ kind: 'entity', name: 'Arjun' });
    expect(report.erasedFacts).toHaveLength(1);
    expect(report.scanClean).toBe(true);
    expect(memory.summarise()).toContain('reports to Meera');
    expect(memory.summarise()).not.toContain('Arjun');
  });

  it('resolves "my old manager" to the former manager, not the current one', () => {
    const report = memory.forget({ kind: 'entity', name: 'my old manager' });
    expect(report.entityIds).toHaveLength(1);
    expect(memory.summarise()).toContain('Meera');
    expect(memory.summarise()).not.toContain('Arjun');
  });

  it('resolves "my manager" to the current one only, since the old one became former', () => {
    const report = memory.forget({ kind: 'entity', name: 'my manager' });
    expect(report.entityIds).toHaveLength(1);
    expect(memory.summarise()).not.toContain('Meera');
    expect(memory.summarise()).toContain('Arjun');
  });

  it('reports ambiguity instead of guessing when a role matches several people', () => {
    new EntitiesRepo(memory.rawDb()).upsert({ name: 'Max', type: 'pet', roles: ['pet', 'dog'] });
    const report = memory.forget({ kind: 'entity', name: 'my dog' });
    expect(report.entityIds).toHaveLength(2);
    expect(report.erasedFacts).toEqual([]);
    expect(report.probes).toEqual([{ name: 'unambiguous', passed: false }]);
    expect(memory.summarise()).toContain('Bruno');
  });

  it('reports an unknown person without touching anything', () => {
    const before = memory.facts().length;
    const report = memory.forget({ kind: 'entity', name: 'my sister' });
    expect(report.entityIds).toEqual([]);
    expect(report.erasedFacts).toEqual([]);
    expect(memory.facts()).toHaveLength(before);
  });
});

describe('forget by predicate and domain', () => {
  it('erases every allergy and its source turn', () => {
    const report = memory.forget({ kind: 'predicate', predicate: 'allergic_to' });
    expect(report.erasedFacts).toHaveLength(1);
    expect(report.redactedTurns).toHaveLength(1);
    expect(report.scanClean).toBe(true);
    expect(memory.summarise()).not.toContain('peanuts');
  });

  it('erases a whole domain', () => {
    const report = memory.forget({ kind: 'domain', domain: 'location' });
    expect(report.erasedFacts).toHaveLength(3);
    expect(memory.summarise()).not.toContain('Hyderabad');
    expect(memory.summarise()).not.toContain('Pune');
  });
});

describe('deletion invariant', () => {
  it('after forgetting an entity, no text column anywhere contains the name or any alias', () => {
    memory.forget({ kind: 'entity', name: 'Priya' });
    const needles = ['Priya', 'Pri'];
    for (const fact of memory.facts(true)) {
      expect(containsName(fact.objectText, needles)).toBe(false);
      expect(containsName(fact.quote, needles)).toBe(false);
    }
    const rows = memory.rawDb().prepare('SELECT text FROM turns').all() as { text: string | null }[];
    for (const row of rows) expect(containsName(row.text, needles)).toBe(false);
    const entities = memory.rawDb().prepare('SELECT canonical_name, aliases_json FROM entities').all() as {
      canonical_name: string | null;
      aliases_json: string;
    }[];
    for (const row of entities) {
      expect(containsName(row.canonical_name, needles)).toBe(false);
      expect(containsName(row.aliases_json, needles)).toBe(false);
    }
  });
});
