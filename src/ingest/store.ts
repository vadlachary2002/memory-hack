// The last gate before the ledger. Refusals here are rules, not judgment.

import type { EntitiesRepo } from '../db/entities.repo.js';
import type { FactsRepo } from '../db/facts.repo.js';
import type { RejectReason } from '../types.js';
import { PREDICATES } from '../vocab.js';
import type { Candidate } from './extract.js';
import { markFormer, markSupersededFormer } from './resolve.js';
import { hasAccountNumber } from './secrets.js';

export type StoreOutcome =
  | { kind: 'stored'; id: number; superseded: number[] }
  | { kind: 'noop'; id: number }
  | { kind: 'closed'; ids: number[] }
  | { kind: 'rejected'; reason: RejectReason };

// Text addressed to the assistant or phrased as an instruction is not a statement about the user.
const INSTRUCTION =
  /^(please\s+)?(send|pay|transfer|wire|deposit|remember|always|never|ignore|forward|do not|don't|make sure|note that|from now on|you must|you should|you need to)\b/i;
const ADDRESSED = /\b(you (must|should|need to|have to)|the assistant|system prompt|as an ai)\b/i;

export function gate(candidate: Candidate): RejectReason | undefined {
  if (hasAccountNumber(candidate.object) || hasAccountNumber(candidate.quote)) return 'account_number';
  if (INSTRUCTION.test(candidate.quote.trim()) || ADDRESSED.test(candidate.quote)) return 'not_about_user';
  return undefined;
}

export function storeCandidate(
  facts: FactsRepo,
  entities: EntitiesRepo,
  userId: number,
  candidate: Candidate,
  objectEntityId: number | undefined,
  turnId: number,
  sessionIdx: number,
): StoreOutcome {
  const reason = gate(candidate);
  if (reason !== undefined) return { kind: 'rejected', reason };
  const attrKey = candidate.attrKey ?? undefined;
  // A fact about someone in the user's life ("my brother works at TCS") has that person as its subject.
  const subjectId = subjectFor(entities, userId, candidate, sessionIdx);
  if (candidate.ended) {
    const ids = facts.closeOpen(subjectId, candidate.predicate, sessionIdx, {
      objectText: candidate.object,
      objectEntityId,
      attrKey,
    });
    if (ids.length > 0 && objectEntityId !== undefined && PREDICATES[candidate.predicate].relational) {
      markFormer(entities, objectEntityId, candidate.predicate);
    }
    return { kind: 'closed', ids };
  }
  const result = facts.insert({
    subjectEntityId: subjectId,
    predicate: candidate.predicate,
    attrKey,
    objectText: candidate.object,
    objectEntityId,
    quote: candidate.quote,
    sourceTurnId: turnId,
    sessionIdx,
    domains: candidate.domains.length > 0 ? candidate.domains : undefined,
  });
  if (result.noop) return { kind: 'noop', id: result.id };
  markSupersededFormer(entities, facts, result.superseded, candidate.predicate, objectEntityId);
  return { kind: 'stored', id: result.id, superseded: result.superseded };
}

const SELF = /^(me|myself|i|user|the user)$/i;

// The user, or a person the user has introduced. Facts about strangers are not stored under a new name;
// they fall back to the user, which the gate and the quote rule already constrain.
function subjectFor(entities: EntitiesRepo, userId: number, candidate: Candidate, sessionIdx: number): number {
  const about = candidate.about.trim();
  if (about === '' || SELF.test(about)) return userId;
  const existing = entities.byName(about);
  if (existing !== undefined) return existing.id;
  return entities.upsert({ name: about, type: 'person', sessionIdx }).id;
}
