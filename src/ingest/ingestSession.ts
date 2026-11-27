// Orchestrates sessions in two phases. Extraction needs only the session text, so it can run in
// parallel; storing needs the ledger's current state, so it runs strictly in session order.

import type { CallsRepo } from '../db/calls.repo.js';
import type { EntitiesRepo } from '../db/entities.repo.js';
import type { FactsRepo } from '../db/facts.repo.js';
import type { TurnsRepo } from '../db/turns.repo.js';
import type { LlmClient, Usage } from '../llm/client.js';
import { trace } from '../trace.js';
import { SessionInputSchema, type ForgetReport, type ForgetTarget, type IngestReport, type SessionInput } from '../types.js';
import { extractSession, type Candidate, type Rejected } from './extract.js';
import { detectForget } from './intents.js';
import { resolveObject } from './resolve.js';
import { scrubAccountNumbers } from './secrets.js';
import { storeCandidate } from './store.js';
import { splitTurn, storableText, type Span } from './taint.js';

export type Repos = { facts: FactsRepo; entities: EntitiesRepo; turns: TurnsRepo; calls: CallsRepo };

// Supplied by Memory so a forget request inside a session runs the full erase-and-audit path.
export type OnForget = (target: ForgetTarget, atSession: number) => ForgetReport;

// Everything the model contributed for one session, before anything touches the database.
export type Prepared = {
  session: SessionInput;
  clean: Span[];
  tainted: number;
  forgets: ForgetTarget[];
  accepted: Candidate[];
  rejected: Rejected[];
  usage?: Usage;
};

export async function ingestSession(repos: Repos, client: LlmClient, input: SessionInput, onForget?: OnForget): Promise<IngestReport> {
  rejectKnown(repos, [input]);
  return storePhase(repos, await extractPhase(client, input), onForget);
}

// Fail before any model call when a session index is already in the ledger.
function rejectKnown(repos: Repos, inputs: readonly SessionInput[]): void {
  for (const input of inputs) {
    if (repos.turns.hasSession(input.index)) throw new Error(`session ${input.index} was already ingested`);
  }
}

// Many sessions: extract up to `concurrency` at a time, then store in index order.
export async function ingestMany(
  repos: Repos,
  client: LlmClient,
  inputs: readonly SessionInput[],
  onForget?: OnForget,
  concurrency = 4,
): Promise<IngestReport[]> {
  const sessions = [...inputs].sort((a, b) => a.index - b.index);
  rejectKnown(repos, sessions);
  const prepared = new Array<Prepared | undefined>(sessions.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < sessions.length) {
      const at = next;
      next += 1;
      prepared[at] = await extractPhase(client, sessions[at] as SessionInput);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return prepared.map((item) => storePhase(repos, item as Prepared, onForget));
}

// Phase one: taint, forget detection, one extraction call, validation. No database access.
export async function extractPhase(client: LlmClient, input: SessionInput): Promise<Prepared> {
  const session = SessionInputSchema.parse(input);
  const clean: Span[] = [];
  const forgets: ForgetTarget[] = [];
  let tainted = 0;
  session.turns.forEach((turn, position) => {
    if (turn.role !== 'user') return;
    const split = splitTurn(position + 1, turn.text);
    tainted += split.tainted.length;
    // A forget request is an instruction, not a fact: it is carried out, never extracted.
    const requests = split.clean.flatMap((span) => detectForget(span.text));
    if (requests.length > 0) forgets.push(...requests);
    else clean.push(...split.clean);
  });
  if (clean.length === 0) return { session, clean, tainted, forgets, accepted: [], rejected: [] };
  const extracted = await extractSession(client, clean);
  return { session, clean, tainted, forgets, accepted: extracted.accepted, rejected: extracted.rejected, usage: extracted.usage };
}

// Phase two: turns, facts, forgets, cost. Must run in session order.
export function storePhase(repos: Repos, prepared: Prepared, onForget?: OnForget): IngestReport {
  const { session } = prepared;
  const report: IngestReport = { session: session.index, stored: [], superseded: [], rejected: [...prepared.rejected], tainted: prepared.tainted, forgotten: [], cost: 0 };
  const userId = repos.entities.ensureUser();
  if (repos.turns.hasSession(session.index)) throw new Error(`session ${session.index} was already ingested`);
  repos.turns.addSession(session.index, session.date);

  // The transcript never keeps pasted content or account numbers, even though it is never recalled.
  const turnIds = new Map<number, number>();
  session.turns.forEach((turn, position) => {
    const stored = scrubAccountNumbers(turn.role === 'user' ? storableText(turn.text) : turn.text);
    turnIds.set(position + 1, repos.turns.addTurn(session.index, position + 1, turn.role, stored));
  });

  if (prepared.usage !== undefined) report.cost = repos.calls.record('extract', prepared.usage, session.index);
  for (const candidate of prepared.accepted) {
    const turnId = turnIds.get(candidate.turnIndex);
    if (turnId === undefined) continue;
    const context = prepared.clean.filter((span) => span.turnIndex === candidate.turnIndex).map((span) => span.text).join(' ');
    const objectEntityId = resolveObject(repos.entities, candidate, session.index, context);
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

  // Forget runs last so facts stated earlier in the same session are erased too.
  if (onForget !== undefined) for (const target of prepared.forgets) report.forgotten.push(onForget(target, session.index));
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
