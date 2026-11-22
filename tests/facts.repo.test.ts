import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { EntitiesRepo } from '../src/db/entities.repo.js';
import { FactsRepo, type NewFact } from '../src/db/facts.repo.js';
import { TurnsRepo } from '../src/db/turns.repo.js';

let db: Db;
let facts: FactsRepo;
let userId: number;

function fact(overrides: Partial<NewFact> & Pick<NewFact, 'predicate' | 'objectText' | 'sessionIdx'>): NewFact {
  return { subjectEntityId: userId, quote: overrides.objectText, ...overrides };
}

beforeEach(() => {
  db = openDb(':memory:');
  facts = new FactsRepo(db);
  userId = new EntitiesRepo(db).ensureUser();
  const turns = new TurnsRepo(db);
  for (const idx of [2, 5, 9, 18, 22, 27, 44]) turns.addSession(idx);
});

describe('functional supersession', () => {
  it('closes the previous open row when a new value arrives', () => {
    const pune = facts.insert(fact({ predicate: 'lives_in', objectText: 'Pune', sessionIdx: 2 }));
    const blr = facts.insert(fact({ predicate: 'lives_in', objectText: 'Bengaluru', sessionIdx: 18 }));
    expect(blr.superseded).toEqual([pune.id]);
    expect(facts.byId(pune.id)?.validTo).toBe(18);
    expect(facts.byId(blr.id)?.validTo).toBeNull();
    expect(facts.currentFor(userId, 'lives_in').map((row) => row.objectText)).toEqual(['Bengaluru']);
  });

  it('treats the same value as a no-op and keeps the original id', () => {
    const first = facts.insert(fact({ predicate: 'lives_in', objectText: 'Pune', sessionIdx: 2 }));
    const again = facts.insert(fact({ predicate: 'lives_in', objectText: 'pune', sessionIdx: 9 }));
    expect(again).toEqual({ id: first.id, superseded: [], noop: true });
    expect(facts.all()).toHaveLength(1);
  });

  it('scopes attribute supersession by key', () => {
    const phone = facts.insert(fact({ predicate: 'attribute', attrKey: 'phone', objectText: 'Android', sessionIdx: 2 }));
    facts.insert(fact({ predicate: 'attribute', attrKey: 'laptop', objectText: 'ThinkPad', sessionIdx: 5 }));
    const iphone = facts.insert(fact({ predicate: 'attribute', attrKey: 'phone', objectText: 'iPhone', sessionIdx: 18 }));
    expect(iphone.superseded).toEqual([phone.id]);
    expect(facts.currentFor(userId, 'attribute').map((row) => row.objectText)).toEqual(['ThinkPad', 'iPhone']);
  });

  it('supersedes relational facts by object entity', () => {
    const entities = new EntitiesRepo(db);
    const arjun = entities.upsert({ name: 'Arjun', type: 'person' });
    const meera = entities.upsert({ name: 'Meera', type: 'person' });
    const first = facts.insert(fact({ predicate: 'reports_to', objectText: 'Arjun', objectEntityId: arjun.id, sessionIdx: 2 }));
    const second = facts.insert(fact({ predicate: 'reports_to', objectText: 'Meera', objectEntityId: meera.id, sessionIdx: 18 }));
    expect(second.superseded).toEqual([first.id]);
    expect(facts.currentFor(userId, 'reports_to').map((row) => row.objectEntityId)).toEqual([meera.id]);
  });
});

describe('non-functional predicates', () => {
  it('keeps several open values and dedupes repeats', () => {
    facts.insert(fact({ predicate: 'allergic_to', objectText: 'peanuts', sessionIdx: 2 }));
    facts.insert(fact({ predicate: 'allergic_to', objectText: 'shellfish', sessionIdx: 5 }));
    const repeat = facts.insert(fact({ predicate: 'allergic_to', objectText: 'Peanuts', sessionIdx: 9 }));
    expect(repeat.noop).toBe(true);
    expect(facts.currentFor(userId, 'allergic_to').map((row) => row.objectText)).toEqual(['peanuts', 'shellfish']);
  });
});

describe('validAt', () => {
  it('returns the value whose interval covers the session', () => {
    facts.insert(fact({ predicate: 'lives_in', objectText: 'Pune', sessionIdx: 2 }));
    facts.insert(fact({ predicate: 'lives_in', objectText: 'Bengaluru', sessionIdx: 18 }));
    facts.insert(fact({ predicate: 'lives_in', objectText: 'Hyderabad', sessionIdx: 44 }));
    const at = (session: number): string[] => facts.validAt(userId, 'lives_in', session).map((row) => row.objectText ?? '');
    expect(at(1)).toEqual([]);
    expect(at(2)).toEqual(['Pune']);
    expect(at(5)).toEqual(['Pune']);
    expect(at(17)).toEqual(['Pune']);
    expect(at(18)).toEqual(['Bengaluru']);
    expect(at(44)).toEqual(['Hyderabad']);
    expect(at(60)).toEqual(['Hyderabad']);
  });
});

describe('closing', () => {
  it('closes an ended scratch fact by value and leaves others open', () => {
    const app = facts.insert(fact({ predicate: 'started_project', objectText: 'budgeting app', sessionIdx: 22 }));
    facts.insert(fact({ predicate: 'started_project', objectText: 'home server', sessionIdx: 22 }));
    const closed = facts.closeOpen(userId, 'started_project', 27, { objectText: 'Budgeting App' });
    expect(closed).toEqual([app.id]);
    expect(facts.byId(app.id)?.validTo).toBe(27);
    expect(facts.currentFor(userId, 'started_project').map((row) => row.objectText)).toEqual(['home server']);
  });

  it('close is idempotent', () => {
    const row = facts.insert(fact({ predicate: 'lives_in', objectText: 'Pune', sessionIdx: 2 }));
    expect(facts.close(row.id, 18)).toBe(true);
    expect(facts.close(row.id, 44)).toBe(false);
    expect(facts.byId(row.id)?.validTo).toBe(18);
  });
});

describe('byDomains', () => {
  it('excludes scratch and closed rows and matches any tagged domain', () => {
    facts.insert(fact({ predicate: 'allergic_to', objectText: 'peanuts', sessionIdx: 9 }));
    facts.insert(fact({ predicate: 'lives_in', objectText: 'Pune', sessionIdx: 2 }));
    facts.insert(fact({ predicate: 'lives_in', objectText: 'Bengaluru', sessionIdx: 18 }));
    facts.insert(fact({ predicate: 'searched_for', objectText: 'flights to Goa', sessionIdx: 22 }));
    expect(facts.byDomains(['health']).map((row) => row.objectText)).toEqual(['peanuts']);
    expect(facts.byDomains(['location']).map((row) => row.objectText)).toEqual(['Bengaluru']);
    expect(facts.byDomains(['location'], 5).map((row) => row.objectText)).toEqual(['Pune']);
    expect(facts.byDomains(['travel'])).toEqual([]);
    expect(facts.byDomains([])).toEqual([]);
  });
});

describe('scanText', () => {
  it('finds names inside objects and quotes, case-insensitive', () => {
    const row = facts.insert(
      fact({ predicate: 'adopted_pet', objectText: 'Bruno', quote: 'Priya and I adopted Bruno', sessionIdx: 5 }),
    );
    expect(facts.scanText(['priya'])).toEqual([row.id]);
    expect(facts.scanText(['Meera', ''])).toEqual([]);
  });
});
