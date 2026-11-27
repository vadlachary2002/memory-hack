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
import { detectEndings, detectForget } from './intents.js';
import { markFormer, resolveObject } from './resolve.js';
import { scrubAccountNumbers } from './secrets.js';
import { storeCandidate } from './store.js';
import { screenSuspects } from './screen.js';
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
  screenUsage?: Usage;
  // Suspect paragraphs the screen step released, mapped to the user's own words inside them.
  released: Map<string, string>;
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
  const suspects: Span[] = [];
  session.turns.forEach((turn, position) => {
    if (turn.role !== 'user') return;
    const split = splitTurn(position + 1, turn.text);
    for (const span of split.tainted) {
      if (span.reason === 'too_long') suspects.push(span);
      else tainted += 1;
    }
    // A forget request is an instruction, not a fact: it is carried out, never extracted.
    const requests = split.clean.flatMap((span) => detectForget(span.text));
    if (requests.length > 0) forgets.push(...requests);
    else clean.push(...split.clean);
  });
  // Long unbroken paragraphs are neither trusted nor dropped on length alone: a cheap call says
  // whether the user wrote them, and can only release text, never widen what code allowed.
  const released = new Map<string, string>();
  let screenUsage: Usage | undefined;
  if (suspects.length > 0) {
    const screened = await screenSuspects(client, suspects);
    screenUsage = screened.usage;
    for (const span of screened.released) {
      released.set(span.original, span.text);
      clean.push({ turnIndex: span.turnIndex, text: span.text });
    }
    tainted += suspects.length - screened.released.length;
  }
  const base = { session, clean, tainted, forgets, released, ...(screenUsage === undefined ? {} : { screenUsage }) };
  if (clean.length === 0) return { ...base, accepted: [], rejected: [] };
  const extracted = await extractSession(client, clean);
  return { ...base, accepted: extracted.accepted, rejected: extracted.rejected, usage: extracted.usage };
}

function isSelf(about: string): boolean {
  return /^(me|myself|i|we|us|user|the user)?$/i.test(about.trim());
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
    const stored = scrubAccountNumbers(turn.role === 'user' ? storableText(turn.text, prepared.released) : turn.text);
    turnIds.set(position + 1, repos.turns.addTurn(session.index, position + 1, turn.role, stored));
  });

  if (prepared.usage !== undefined) report.cost = repos.calls.record('extract', prepared.usage, session.index);
  if (prepared.screenUsage !== undefined) report.cost += repos.calls.record('screen', prepared.screenUsage, session.index);
  // Facts about the user first: they introduce the people that facts about others may then attach to.
  const ordered = [...prepared.accepted].sort((a, b) => Number(!isSelf(a.about)) - Number(!isSelf(b.about)));
  for (const candidate of ordered) {
    const turnId = turnIds.get(candidate.turnIndex);
    if (turnId === undefined) continue;
    const context = prepared.clean.filter((span) => span.turnIndex === candidate.turnIndex).map((span) => span.text).join(' ');
    const objectEntityId = resolveObject(repos.entities, candidate, session.index, context);
    const outcome = storeCandidate(repos.facts, repos.entities, userId, candidate, objectEntityId, turnId, session.index, context);
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

  // Relationship endings found in code close the partner fact even when the extractor missed them.
  for (const ending of prepared.clean.flatMap((span) => detectEndings(span.text))) {
    const partner = ending.name === undefined ? undefined : repos.entities.byName(ending.name);
    const closed = repos.facts.closeOpen(userId, ending.predicate, session.index, partner === undefined ? {} : { objectEntityId: partner.id });
    for (const id of closed) {
      const row = repos.facts.byId(id);
      if (row?.objectEntityId != null) markFormer(repos.entities, row.objectEntityId, ending.predicate);
      report.superseded.push(id);
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
