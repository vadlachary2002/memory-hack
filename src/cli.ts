// Bare CLI for step 1: reset, load a fixture, list facts, render summaries.
// Later steps add ingest, ask, forget, audit and harness.

import { readFileSync } from 'node:fs';
import { dbPath } from './config.js';
import { openDb, resetDb } from './db/connection.js';
import { EntitiesRepo } from './db/entities.repo.js';
import { FactsRepo } from './db/facts.repo.js';
import { TurnsRepo } from './db/turns.repo.js';
import { FixtureSchema, loadFixture } from './fixture.js';
import { renderLine, renderProfile, renderSession } from './render.js';

const USAGE = `usage:
  cli reset                 drop and recreate the database
  cli load <fixture.json>   replay a hand-written fact fixture
  cli facts                 list every fact row, erased included
  cli summary [session]     render the profile, or one session`;

main(process.argv.slice(2));

function main(args: readonly string[]): void {
  const [command, arg] = args;
  const db = openDb(dbPath());
  const entities = new EntitiesRepo(db);
  const facts = new FactsRepo(db);
  const turns = new TurnsRepo(db);
  const nameOf = (id: number): string => entities.nameOf(id);

  switch (command) {
    case 'reset': {
      resetDb(db);
      console.log(`reset ${dbPath()}`);
      return;
    }
    case 'load': {
      if (arg === undefined) return fail('load needs a fixture path');
      const fixture = FixtureSchema.parse(JSON.parse(readFileSync(arg, 'utf8')));
      const report = loadFixture(db, fixture);
      console.log(
        `inserted ${report.inserted.length}, superseded ${report.superseded.length}, closed ${report.closed.length}, no-ops ${report.noops}`,
      );
      return;
    }
    case 'facts': {
      for (const fact of facts.all(true)) {
        const state = fact.erasedAt !== null ? 'erased' : fact.validTo === null ? 'open' : 'closed';
        console.log(`${String(fact.id).padStart(3)} ${state.padEnd(6)} ${fact.tier.padEnd(7)} ${renderLine(fact, nameOf)}`);
      }
      return;
    }
    case 'summary': {
      const all = facts.all();
      if (arg === undefined) {
        console.log(renderProfile(all, nameOf, turns.latestSession()));
      } else {
        console.log(renderSession(all, Number(arg), nameOf));
      }
      return;
    }
    default:
      return fail(USAGE);
  }
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}
