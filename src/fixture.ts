// Hand-written fact fixtures for the bare CLI and tests. Loads turns and facts without any model.

import { z } from 'zod';
import type { Db } from './db/connection.js';
import { EntitiesRepo } from './db/entities.repo.js';
import { FactsRepo, type InsertResult } from './db/facts.repo.js';
import { TurnsRepo } from './db/turns.repo.js';
import { DomainSchema, PredicateSchema } from './types.js';

const FixtureEntitySchema = z.object({
  key: z.string(),
  name: z.string(),
  type: z.enum(['person', 'pet', 'org', 'place', 'thing']),
  aliases: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
});

const FixtureFactSchema = z.object({
  predicate: PredicateSchema,
  attrKey: z.string().optional(),
  object: z.string(),
  objectEntity: z.string().optional(),
  quote: z.string(),
  domains: z.array(DomainSchema).optional(),
});

const FixtureCloseSchema = z.object({
  predicate: PredicateSchema,
  object: z.string().optional(),
  objectEntity: z.string().optional(),
  attrKey: z.string().optional(),
});

const FixtureEventSchema = z.object({
  session: z.number().int().positive(),
  turn: z.string(),
  fact: FixtureFactSchema.optional(),
  close: FixtureCloseSchema.optional(),
});

export const FixtureSchema = z.object({
  entities: z.array(FixtureEntitySchema),
  events: z.array(FixtureEventSchema),
});

export type Fixture = z.infer<typeof FixtureSchema>;

export type LoadReport = { inserted: number[]; superseded: number[]; closed: number[]; noops: number };

// Replays the fixture in order so supersession happens exactly as it would on ingest.
export function loadFixture(db: Db, fixture: Fixture): LoadReport {
  const entities = new EntitiesRepo(db);
  const facts = new FactsRepo(db);
  const turns = new TurnsRepo(db);
  const userId = entities.ensureUser();
  const ids = new Map<string, number>();
  const report: LoadReport = { inserted: [], superseded: [], closed: [], noops: 0 };

  for (const entity of fixture.entities) {
    const row = entities.upsert({ name: entity.name, type: entity.type, aliases: entity.aliases, roles: entity.roles });
    ids.set(entity.key, row.id);
  }

  const turnCounters = new Map<number, number>();
  for (const event of fixture.events) {
    turns.addSession(event.session);
    const turnIdx = (turnCounters.get(event.session) ?? 0) + 1;
    turnCounters.set(event.session, turnIdx);
    const turnId = turns.addTurn(event.session, turnIdx, 'user', event.turn);

    if (event.fact) {
      const objectEntityId = event.fact.objectEntity === undefined ? undefined : requireId(ids, event.fact.objectEntity);
      const result: InsertResult = facts.insert({
        subjectEntityId: userId,
        predicate: event.fact.predicate,
        attrKey: event.fact.attrKey,
        objectText: event.fact.object,
        objectEntityId,
        quote: event.fact.quote,
        sourceTurnId: turnId,
        sessionIdx: event.session,
        domains: event.fact.domains,
      });
      if (result.noop) report.noops += 1;
      else report.inserted.push(result.id);
      report.superseded.push(...result.superseded);
    }

    if (event.close) {
      const objectEntityId = event.close.objectEntity === undefined ? undefined : requireId(ids, event.close.objectEntity);
      const closed = facts.closeOpen(userId, event.close.predicate, event.session, {
        objectText: event.close.object,
        objectEntityId,
        attrKey: event.close.attrKey,
      });
      report.closed.push(...closed);
    }
  }
  return report;
}

function requireId(ids: Map<string, number>, key: string): number {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`fixture references unknown entity key "${key}"`);
  return id;
}
