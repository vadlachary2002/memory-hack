// The last gate before the ledger. Refusals here are rules, not judgment.

import type { FactsRepo } from '../db/facts.repo.js';
import type { RejectReason } from '../types.js';
import type { Candidate } from './extract.js';

export type StoreOutcome =
  | { kind: 'stored'; id: number; superseded: number[] }
  | { kind: 'noop'; id: number }
  | { kind: 'closed'; ids: number[] }
  | { kind: 'rejected'; reason: RejectReason };

// Bank and account shapes: "ACC-7781", "HDFC00012345", 8+ digit runs, IBAN-like strings.
const ACCOUNT_NUMBER = /\b[A-Z]{2,5}-?\d{4,}\b|\b\d{8,}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/;

// Text addressed to the assistant or phrased as an instruction is not a statement about the user.
const INSTRUCTION =
  /^(please\s+)?(send|pay|transfer|wire|deposit|remember|always|never|ignore|forward|do not|don't|make sure|note that|from now on|you must|you should|you need to)\b/i;
const ADDRESSED = /\b(you (must|should|need to|have to)|the assistant|system prompt|as an ai)\b/i;

export function gate(candidate: Candidate): RejectReason | undefined {
  if (ACCOUNT_NUMBER.test(candidate.object) || ACCOUNT_NUMBER.test(candidate.quote)) return 'account_number';
  if (INSTRUCTION.test(candidate.quote.trim()) || ADDRESSED.test(candidate.quote)) return 'not_about_user';
  return undefined;
}

export function storeCandidate(
  facts: FactsRepo,
  userId: number,
  candidate: Candidate,
  objectEntityId: number | undefined,
  turnId: number,
  sessionIdx: number,
): StoreOutcome {
  const reason = gate(candidate);
  if (reason !== undefined) return { kind: 'rejected', reason };
  const attrKey = candidate.attrKey ?? undefined;
  if (candidate.ended) {
    const ids = facts.closeOpen(userId, candidate.predicate, sessionIdx, {
      objectText: candidate.object,
      objectEntityId,
      attrKey,
    });
    return { kind: 'closed', ids };
  }
  const result = facts.insert({
    subjectEntityId: userId,
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
  return { kind: 'stored', id: result.id, superseded: result.superseded };
}
