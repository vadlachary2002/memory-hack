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

export const ForgetTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), name: z.string().min(1) }),
  z.object({ kind: z.literal('predicate'), predicate: PredicateSchema }),
  z.object({ kind: z.literal('domain'), domain: DomainSchema }),
]);

export type ForgetTarget = z.infer<typeof ForgetTargetSchema>;

// Ids only, never names.
export const ForgetReportSchema = z.object({
  entityIds: z.array(z.number().int()),
  erasedFacts: z.array(z.number().int()),
  strippedFacts: z.array(z.number().int()),
  redactedTurns: z.array(z.number().int()),
  probes: z.array(z.object({ name: z.string(), passed: z.boolean() })),
  scanClean: z.boolean(),
});

export type ForgetReport = z.infer<typeof ForgetReportSchema>;

export const IngestReportSchema = z.object({
  session: z.number().int(),
  stored: z.array(z.number().int()),
  superseded: z.array(z.number().int()),
  rejected: z.array(z.object({ reason: RejectReasonSchema, candidate: z.string() })),
  tainted: z.number().int(),
  // Forget requests found in the session's user turns and carried out.
  forgotten: z.array(ForgetReportSchema),
  cost: z.number(),
});

export type IngestReport = z.infer<typeof IngestReportSchema>;

export const AnswerSchema = z.object({
  text: z.string(),
  cited: z.array(z.number().int()),
  abstained: z.boolean(),
  candidates: z.array(z.number().int()),
  domains: z.array(DomainSchema),
  // The session the answer is as of, when a cutoff or a time anchor applied.
  asOf: z.number().int().optional(),
  cost: z.number(),
});

export type Answer = z.infer<typeof AnswerSchema>;

// Result of scanning every text column for a name. Ids only.
export const AuditReportSchema = z.object({
  factHits: z.array(z.number().int()),
  turnHits: z.array(z.number().int()),
  entityHits: z.array(z.number().int()),
  summaryHit: z.boolean(),
  clean: z.boolean(),
});

export type AuditReport = z.infer<typeof AuditReportSchema>;
