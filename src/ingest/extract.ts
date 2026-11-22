// One structured call per session, then validation in code. A candidate survives only if
// its object is inside its quote and its quote is inside a clean span of its turn.

import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import type { Usage } from '../llm/client.js';
import { EXTRACT_SYSTEM } from '../llm/prompts.js';
import type { RejectReason } from '../types.js';
import { DOMAINS, PREDICATE_NAMES } from '../vocab.js';
import type { Span } from './taint.js';

export const CandidateSchema = z.object({
  turnIndex: z.number().int(),
  predicate: z.enum(PREDICATE_NAMES),
  attrKey: z.string().nullable(),
  object: z.string(),
  quote: z.string(),
  objectIsEntity: z.boolean(),
  entityType: z.enum(['person', 'pet']).nullable(),
  aliases: z.array(z.string()),
  domains: z.array(z.enum(DOMAINS)),
  ended: z.boolean(),
});

export type Candidate = z.infer<typeof CandidateSchema>;

export const ExtractionSchema = z.object({ facts: z.array(CandidateSchema) });

export type Rejected = { reason: RejectReason; candidate: string };

export type ExtractResult = { accepted: Candidate[]; rejected: Rejected[]; usage: Usage };

export async function extractSession(client: LlmClient, cleanSpans: readonly Span[]): Promise<ExtractResult> {
  const user = cleanSpans.map((span) => `turn ${span.turnIndex}: ${span.text}`).join('\n\n');
  const { value, usage } = await client.structured({
    purpose: 'extract',
    schema: ExtractionSchema,
    system: EXTRACT_SYSTEM,
    user,
  });
  const { accepted, rejected } = validateCandidates(value.facts, cleanSpans);
  return { accepted, rejected, usage };
}

// Pure. Exported so tests can exercise the rules without a client.
export function validateCandidates(
  candidates: readonly Candidate[],
  cleanSpans: readonly Span[],
): { accepted: Candidate[]; rejected: Rejected[] } {
  const accepted: Candidate[] = [];
  const rejected: Rejected[] = [];
  for (const candidate of candidates) {
    const reason = validate(candidate, cleanSpans);
    if (reason === undefined) accepted.push(candidate);
    else rejected.push({ reason, candidate: label(candidate) });
  }
  return { accepted, rejected };
}

function validate(candidate: Candidate, cleanSpans: readonly Span[]): RejectReason | undefined {
  const quote = squash(candidate.quote);
  const object = squash(candidate.object);
  if (quote === '' || object === '') return 'empty';
  const spans = cleanSpans.filter((span) => span.turnIndex === candidate.turnIndex);
  if (spans.length === 0) return 'quote_not_in_turn';
  if (!spans.some((span) => squash(span.text).includes(quote))) return 'quote_not_in_turn';
  if (!quote.includes(object)) return 'object_not_in_quote';
  return undefined;
}

// Whitespace-insensitive, case-sensitive comparison.
export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function label(candidate: Candidate): string {
  const key = candidate.attrKey === null ? '' : `[${candidate.attrKey}]`;
  return `${candidate.predicate}${key} ${candidate.object}`;
}
