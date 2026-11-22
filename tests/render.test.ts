import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { EntitiesRepo } from '../src/db/entities.repo.js';
import { FactsRepo } from '../src/db/facts.repo.js';
import { FixtureSchema, loadFixture, type LoadReport } from '../src/fixture.js';
import { renderProfile, renderSession } from '../src/render.js';

const FIXTURE = FixtureSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/facts.json', import.meta.url), 'utf8')));

let db: Db;
let facts: FactsRepo;
let nameOf: (id: number) => string;
let report: LoadReport;

beforeEach(() => {
  db = openDb(':memory:');
  report = loadFixture(db, FIXTURE);
  facts = new FactsRepo(db);
  const entities = new EntitiesRepo(db);
  nameOf = (id) => entities.nameOf(id);
});

describe('fixture replay', () => {
  it('supersedes the two earlier homes and the first manager, dedupes the repeated allergy', () => {
    expect(report.superseded).toHaveLength(3);
    expect(report.closed).toHaveLength(2);
    expect(report.noops).toBe(1);
  });
});

describe('renderProfile', () => {
  it('lists current facts and closed facts, scratch excluded', () => {
    const text = renderProfile(facts.all(), nameOf, 46);
    expect(text).toContain('Profile (as of session 46)');
    expect(text).toMatch(/^- lives in Hyderabad \(since s44\) \[f\d+\]$/m);
    expect(text).toMatch(/^- reports to Meera \(since s35\)/m);
    expect(text).toMatch(/^- phone: iPhone \(since s16\)/m);
    expect(text).toContain('No longer true:');
    expect(text).toMatch(/^- lives in Pune \(s2 to s18\)/m);
    expect(text).toMatch(/^- lives in Bengaluru \(s18 to s44\)/m);
    expect(text).toMatch(/^- partner Priya \(s14 to s46\)/m);
    expect(text).not.toContain('flights to Goa');
    expect(text).not.toContain('budgeting app');
  });

  it('is deterministic', () => {
    const once = renderProfile(facts.all(), nameOf);
    const twice = renderProfile(facts.all(), nameOf);
    expect(once).toBe(twice);
  });
});

describe('renderSession', () => {
  it('shows what one session recorded, scratch tagged', () => {
    expect(renderSession(facts.all(), 5, nameOf)).toMatch(/^- adopted pet Bruno \(since s5\)/m);
    expect(renderSession(facts.all(), 20, nameOf)).toContain('(scratch)');
    expect(renderSession(facts.all(), 1, nameOf)).toContain('nothing recorded');
  });
});
