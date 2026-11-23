// The library. Adapters (CLI, HTTP, batch) call only this class.

import { dbPathForUser } from './config.js';
import { CallsRepo, type CostReport } from './db/calls.repo.js';
import { openDb, resetDb, type Db } from './db/connection.js';
import { EntitiesRepo } from './db/entities.repo.js';
import { FactsRepo, type FactRow } from './db/facts.repo.js';
import { TurnsRepo } from './db/turns.repo.js';
import { audit, forget, type ForgetContext } from './forget/forget.js';
import { ingestSession, type Repos } from './ingest/ingestSession.js';
import type { LlmClient } from './llm/client.js';
import { ask, type AskOptions } from './recall/ask.js';
import { renderProfile, renderSession } from './render.js';
import type { Answer, AuditReport, ForgetReport, ForgetTarget, IngestReport, SessionInput } from './types.js';

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
  // A "forget ..." request inside the session runs the full erase-and-audit path.
  ingest(session: SessionInput): Promise<IngestReport> {
    const onForget = (target: ForgetTarget, atSession: number): ForgetReport => this.forget(target, { atSession });
    return ingestSession(this.repos, this.options.llm, session, onForget);
  }

  // Classify, closed-world select, cited answer. Unknown people or roles abstain with no answer call.
  ask(question: string, opts: AskOptions = {}): Promise<Answer> {
    return ask(this.repos, this.options.llm, question, opts);
  }

  // Physical erase, strip, redact, then self-audit. No model call. Ids only in the report.
  forget(target: ForgetTarget, opts: { atSession?: number } = {}): ForgetReport {
    return forget(this.forgetContext(opts.atSession), target);
  }

  // Scan every text column and the summary for a name. Used to prove a forget, or to find a leak.
  audit(name: string): AuditReport {
    const entity = this.repos.entities.byName(name);
    const needles = entity ? [entity.canonicalName ?? name, ...entity.aliases] : [name];
    return audit(this.forgetContext(), needles);
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

  hasSession(index: number): boolean {
    return this.repos.turns.hasSession(index);
  }

  latestSession(): number {
    return this.repos.turns.latestSession() ?? 0;
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

  private forgetContext(atSession?: number): ForgetContext {
    return {
      ...this.repos,
      summarise: () => this.summarise(),
      atSession: atSession ?? this.repos.turns.latestSession() ?? 0,
    };
  }
}
