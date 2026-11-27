// The last gate before the ledger. Refusals here are rules, not judgment.

import type { EntitiesRepo } from '../db/entities.repo.js';
import type { FactsRepo } from '../db/facts.repo.js';
import type { RejectReason } from '../types.js';
import { PREDICATES } from '../vocab.js';
import type { Candidate } from './extract.js';
import { attribute } from './attribution.js';
import { markFormer, markSupersededFormer } from './resolve.js';
import { hasAccountNumber } from './secrets.js';

export type StoreOutcome =
  | { kind: 'stored'; id: number; superseded: number[] }
  | { kind: 'noop'; id: number }
  | { kind: 'closed'; ids: number[] }
  | { kind: 'rejected'; reason: RejectReason };

// Text addressed to the assistant or phrased as an instruction is not a statement about the user.
// "Remember that I moved" and "note that my logic is" are statements the user asks to keep, so only
// the command forms ("remember to send", "note to self: pay") are refused here; the account-number
// and addressed-to-assistant checks still run on whatever follows "remember".
const INSTRUCTION =
  /^(please\s+)?(send|pay|transfer|wire|deposit|remember (to|not to)|always|never|ignore|forward|do not|don't|make sure|from now on|you must|you should|you need to|note to|instruction)\b/i;
const ADDRESSED =
  /\b(you (must|should|need to|have to|will)|the assistant|the ai|the bot|system prompt|as an ai|from now on|always (say|answer|tell|reply|respond)|never (say|mention|tell))\b/i;

// context is the user's own text around the quote. The sentence the quote sits in is checked too, so
// "the assistant should always say my boss is Rahul" is refused even when the model quotes only the tail.
export function gate(candidate: Candidate, context = ''): RejectReason | undefined {
  if (hasAccountNumber(candidate.object) || hasAccountNumber(candidate.quote)) return 'account_number';
  if (INSTRUCTION.test(candidate.quote.trim()) || ADDRESSED.test(candidate.quote)) return 'not_about_user';
  const sentence = sentenceContaining(context, candidate.quote);
  if (sentence !== undefined && (INSTRUCTION.test(sentence.trim()) || ADDRESSED.test(sentence) || hasAccountNumber(sentence))) {
    return 'not_about_user';
  }
  return undefined;
}

function sentenceContaining(context: string, quote: string): string | undefined {
  const needle = quote.replace(/\s+/g, ' ').trim().toLowerCase();
  if (needle === '') return undefined;
  return context
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .find((sentence) => sentence.toLowerCase().includes(needle));
}

export function storeCandidate(
  facts: FactsRepo,
  entities: EntitiesRepo,
  userId: number,
  candidate: Candidate,
  objectEntityId: number | undefined,
  turnId: number,
  sessionIdx: number,
  context = '',
): StoreOutcome {
  const reason = gate(candidate, context);
  if (reason !== undefined) return { kind: 'rejected', reason };
  const attrKey = candidate.attrKey ?? undefined;
  // A fact about someone in the user's life ("my brother works at TCS") has that person as its subject.
  const subjectId = subjectFor(entities, userId, candidate, context, sessionIdx);
  if (subjectId === undefined) return { kind: 'rejected', reason: 'not_about_user' };
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

const SELF = /^(me|myself|i|we|us|user|the user)$/i;

function namesObject(name: string, candidate: Candidate): boolean {
  const object = candidate.object.trim().toLowerCase();
  const lower = name.toLowerCase();
  return object === lower || object.startsWith(`${lower} `) || candidate.objectIsEntity === true && object.includes(lower);
}

// Who the fact is about. The sentence's grammar wins over the extractor's "about": "my colleague Ravi
// moved" is Ravi's move even if the model said "me". A person introduced with a relationship word
// ("my colleague Ravi") is created with that role; a bare name that appears as the sentence subject is
// created as a contact; a name the ledger does not know and the sentence does not introduce is refused,
// never pinned on the user. A negated statement ("I'm not allergic to anything") is refused.
export function subjectFor(
  entities: EntitiesRepo,
  userId: number,
  candidate: Candidate,
  context: string,
  sessionIdx: number,
): number | undefined {
  const sentence = sentenceContaining(context, candidate.quote) ?? candidate.quote;
  const before = context.slice(0, Math.max(0, context.indexOf(sentence)));
  const grammar = attribute(sentence, before);
  if (grammar.kind === 'negated') return undefined;
  if (grammar.kind === 'unknown') return undefined;
  if (grammar.kind === 'other') {
    // "Neha is my girlfriend": the named person is the fact's object, so the fact is still the user's.
    if (namesObject(grammar.name, candidate)) return userId;
    const existing = entities.byName(grammar.name);
    if (existing !== undefined) return existing.id;
    return entities.upsert({ name: grammar.name, type: 'person', roles: [grammar.role ?? 'contact'], sessionIdx }).id;
  }
  const about = candidate.about.trim().replace(/^my\s+/i, '');
  if (about === '' || SELF.test(about) || /\s(and|&)\s/i.test(about)) return userId;
  return entities.byName(about)?.id;
}
