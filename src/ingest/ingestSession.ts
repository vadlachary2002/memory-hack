// Orchestrates one session: store turns, taint, extract, resolve, store, record cost.

import type { CallsRepo } from '../db/calls.repo.js';
import type { EntitiesRepo } from '../db/entities.repo.js';
import type { FactsRepo } from '../db/facts.repo.js';
import type { TurnsRepo } from '../db/turns.repo.js';
import type { LlmClient } from '../llm/client.js';
import { SessionInputSchema, type IngestReport, type SessionInput } from '../types.js';
import { extractSession } from './extract.js';
import { resolveObject } from './resolve.js';
import { storeCandidate } from './store.js';
import { splitTurn, type Span } from './taint.js';

export type Repos = { facts: FactsRepo; entities: EntitiesRepo; turns: TurnsRepo; calls: CallsRepo };

export async function ingestSession(repos: Repos, client: LlmClient, input: SessionInput): Promise<IngestReport> {
  const session = SessionInputSchema.parse(input);
  const report: IngestReport = { session: session.index, stored: [], superseded: [], rejected: [], tainted: 0, cost: 0 };
  const userId = repos.entities.ensureUser();
  repos.turns.addSession(session.index, session.date);

  // Turn indices are 1-based and count every turn, so a quote can be traced to a line in the transcript.
  const turnIds = new Map<number, number>();
  const clean: Span[] = [];
  session.turns.forEach((turn, position) => {
    const turnIndex = position + 1;
    turnIds.set(turnIndex, repos.turns.addTurn(session.index, turnIndex, turn.role, turn.text));
    if (turn.role !== 'user') return;
    const split = splitTurn(turnIndex, turn.text);
    clean.push(...split.clean);
    report.tainted += split.tainted.length;
  });
  if (clean.length === 0) return report;

  const extracted = await extractSession(client, clean);
  report.cost = repos.calls.record('extract', extracted.usage, session.index);
  report.rejected.push(...extracted.rejected);

  for (const candidate of extracted.accepted) {
    const turnId = turnIds.get(candidate.turnIndex);
    if (turnId === undefined) continue;
    const objectEntityId = resolveObject(repos.entities, candidate, session.index);
    const outcome = storeCandidate(repos.facts, userId, candidate, objectEntityId, turnId, session.index);
    switch (outcome.kind) {
      case 'stored':
        report.stored.push(outcome.id);
        report.superseded.push(...outcome.superseded);
        break;
      case 'closed':
        report.superseded.push(...outcome.ids);
        break;
      case 'rejected':
        report.rejected.push({ reason: outcome.reason, candidate: `${candidate.predicate} ${candidate.object}` });
        break;
      case 'noop':
        break;
    }
  }
  return report;
}
