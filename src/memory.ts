// The library. Adapters (CLI, HTTP, batch) call only this class.

import { dbPathForUser } from './config.js';
import { CallsRepo, type CostReport } from './db/calls.repo.js';
import { openDb, resetDb, type Db } from './db/connection.js';
import { EntitiesRepo } from './db/entities.repo.js';
import { FactsRepo, type FactRow } from './db/facts.repo.js';
import { TurnsRepo } from './db/turns.repo.js';
import { ingestSession, type Repos } from './ingest/ingestSession.js';
import type { LlmClient } from './llm/client.js';
import { renderProfile, renderSession } from './render.js';
import type { Answer, ForgetReport, ForgetTarget, IngestReport, SessionInput } from './types.js';

export type MemoryOptions = { dbPath: string; llm: LlmClient };

export class Memory {
  // Multi-tenant entry point: each user id gets its own database file.
  static forUser(userId: string, llm: LlmClient, dir?: string): Memory {
    return new Memory({ dbPath: dbPathForUser(userId, dir), llm });
  }

  private readonly db: Db;
  private readonly repos: Repos;

  constructor(private readonly options: MemoryOptions) {
    this.db = openDb(options.dbPath);
    this.repos = {
      facts: new FactsRepo(this.db),
      entities: new EntitiesRepo(this.db),
      turns: new TurnsRepo(this.db),
      calls: new CallsRepo(this.db),
    };
  }

  // Store one session: taint, extract, validate, resolve, store. One model call at most.
  ingest(session: SessionInput): Promise<IngestReport> {
    return ingestSession(this.repos, this.options.llm, session);
  }

  // Built in step 4.
  ask(_question: string, _opts?: { asOf?: number }): Promise<Answer> {
    return Promise.reject(new Error('ask is not built yet'));
  }

  // Built in step 3.
  forget(_target: ForgetTarget): Promise<ForgetReport> {
    return Promise.reject(new Error('forget is not built yet'));
  }

  // Deterministic render from facts. Never calls the model.
  summarise(opts: { session?: number } = {}): string {
    const nameOf = (id: number): string => this.repos.entities.nameOf(id);
    const facts = this.repos.facts.all();
    if (opts.session !== undefined) return renderSession(facts, opts.session, nameOf);
    return renderProfile(facts, nameOf, this.repos.turns.latestSession());
  }

  reset(): void {
    resetDb(this.db);
  }

  cost(): CostReport {
    return this.repos.calls.totals();
  }

  // Read-only view for adapters and tests.
  facts(includeErased = false): FactRow[] {
    return this.repos.facts.all(includeErased);
  }

  nameOf(entityId: number): string {
    return this.repos.entities.nameOf(entityId);
  }

  // Escape hatch for the fixture loader and tests only.
  rawDb(): Db {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
