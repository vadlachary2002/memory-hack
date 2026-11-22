// Public input and output shapes of the library, as zod schemas.

import { z } from 'zod';
import { DOMAINS, isPredicate, type Predicate } from './vocab.js';

export const DomainSchema = z.enum(DOMAINS);

export const PredicateSchema = z.custom<Predicate>((value) => typeof value === 'string' && isPredicate(value), {
  message: 'unknown predicate',
});

export const TurnInputSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
});

export const SessionInputSchema = z.object({
  // 1-based session number; this is the time axis.
  index: z.number().int().positive(),
  // ISO date if the harness provides one; display only.
  date: z.string().optional(),
  turns: z.array(TurnInputSchema),
});

export type SessionInput = z.infer<typeof SessionInputSchema>;

export const RejectReasonSchema = z.enum([
  'object_not_in_quote',
  'quote_not_in_turn',
  'unknown_predicate',
  'tainted',
  'account_number',
  'not_about_user',
  'empty',
]);

export type RejectReason = z.infer<typeof RejectReasonSchema>;

export const IngestReportSchema = z.object({
  session: z.number().int(),
  stored: z.array(z.number().int()),
  superseded: z.array(z.number().int()),
  rejected: z.array(z.object({ reason: RejectReasonSchema, candidate: z.string() })),
  tainted: z.number().int(),
  cost: z.number(),
});

export type IngestReport = z.infer<typeof IngestReportSchema>;

export const AnswerSchema = z.object({
  text: z.string(),
  cited: z.array(z.number().int()),
  abstained: z.boolean(),
  candidates: z.array(z.number().int()),
  domains: z.array(DomainSchema),
  cost: z.number(),
});

export type Answer = z.infer<typeof AnswerSchema>;

export const ForgetTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), name: z.string().min(1) }),
  z.object({ kind: z.literal('predicate'), predicate: PredicateSchema }),
  z.object({ kind: z.literal('domain'), domain: DomainSchema }),
]);

export type ForgetTarget = z.infer<typeof ForgetTargetSchema>;

export const ForgetReportSchema = z.object({
  entityIds: z.array(z.number().int()),
  erasedFacts: z.array(z.number().int()),
  strippedFacts: z.array(z.number().int()),
  redactedTurns: z.array(z.number().int()),
  probes: z.array(z.object({ name: z.string(), passed: z.boolean() })),
  scanClean: z.boolean(),
});

export type ForgetReport = z.infer<typeof ForgetReportSchema>;
