// Orchestrates one session: store turns, taint, extract, resolve, store, then honour forget requests.

import type { CallsRepo } from '../db/calls.repo.js';
import type { EntitiesRepo } from '../db/entities.repo.js';
import type { FactsRepo } from '../db/facts.repo.js';
import type { TurnsRepo } from '../db/turns.repo.js';
import type { LlmClient } from '../llm/client.js';
import { trace } from '../trace.js';
import { SessionInputSchema, type ForgetReport, type ForgetTarget, type IngestReport, type SessionInput } from '../types.js';
import { extractSession } from './extract.js';
import { detectForget } from './intents.js';
import { resolveObject } from './resolve.js';
import { scrubAccountNumbers } from './secrets.js';
import { storeCandidate } from './store.js';
import { splitTurn, storableText, type Span } from './taint.js';

export type Repos = { facts: FactsRepo; entities: EntitiesRepo; turns: TurnsRepo; calls: CallsRepo };

// Supplied by Memory so a forget request inside a session runs the full erase-and-audit path.
export type OnForget = (target: ForgetTarget, atSession: number) => ForgetReport;

export async function ingestSession(repos: Repos, client: LlmClient, input: SessionInput, onForget?: OnForget): Promise<IngestReport> {
  const session = SessionInputSchema.parse(input);
  const report: IngestReport = { session: session.index, stored: [], superseded: [], rejected: [], tainted: 0, forgotten: [], cost: 0 };
  const userId = repos.entities.ensureUser();
  if (repos.turns.hasSession(session.index)) throw new Error(`session ${session.index} was already ingested`);
  repos.turns.addSession(session.index, session.date);

  // Turn indices are 1-based and count every turn, so a quote can be traced to a line in the transcript.
  const turnIds = new Map<number, number>();
  const clean: Span[] = [];
  const forgets: ForgetTarget[] = [];
  session.turns.forEach((turn, position) => {
    const turnIndex = position + 1;
    // The transcript never keeps pasted content or account numbers, even though it is never recalled.
    const stored = scrubAccountNumbers(turn.role === 'user' ? storableText(turn.text) : turn.text);
    turnIds.set(turnIndex, repos.turns.addTurn(session.index, turnIndex, turn.role, stored));
    if (turn.role !== 'user') return;
    const split = splitTurn(turnIndex, turn.text);
    report.tainted += split.tainted.length;
    // A forget request is an instruction, not a fact: it is carried out, never extracted.
    const requests = split.clean.flatMap((span) => detectForget(span.text));
    if (requests.length > 0) forgets.push(...requests);
    else clean.push(...split.clean);
  });

  if (clean.length > 0) {
    const extracted = await extractSession(client, clean);
    report.cost = repos.calls.record('extract', extracted.usage, session.index);
    report.rejected.push(...extracted.rejected);
    for (const candidate of extracted.accepted) {
      const turnId = turnIds.get(candidate.turnIndex);
      if (turnId === undefined) continue;
      const objectEntityId = resolveObject(repos.entities, candidate, session.index);
      const outcome = storeCandidate(repos.facts, repos.entities, userId, candidate, objectEntityId, turnId, session.index);
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
  }

  // Forget runs last so facts stated earlier in the same session are erased too.
  if (onForget !== undefined) for (const target of forgets) report.forgotten.push(onForget(target, session.index));
  trace('ingest', {
    session: session.index,
    stored: report.stored,
    superseded: report.superseded,
    rejected: report.rejected.map((item) => item.reason),
    tainted: report.tainted,
    forgotten: report.forgotten.length,
    cost: report.cost,
  });
  return report;
}
