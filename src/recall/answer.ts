// Cited generation and the citation filter. A sentence without a valid citation does not survive.

import { z } from 'zod';
import type { FactRow } from '../db/facts.repo.js';
import type { LlmClient, Usage } from '../llm/client.js';
import { ANSWER_SYSTEM } from '../llm/prompts.js';
import { renderLine, type NameLookup } from '../render.js';

export const AnswerOutputSchema = z.object({
  sentences: z.array(z.object({ text: z.string(), citedIds: z.array(z.number().int()) })),
});

export type AnswerOutput = z.infer<typeof AnswerOutputSchema>;

export const UNKNOWN = "I don't know.";
export const NO_INFO = "I don't have that.";

export type Generated = { text: string; cited: number[]; usage: Usage };

export async function answer(
  client: LlmClient,
  question: string,
  candidates: readonly FactRow[],
  nameOf: NameLookup,
  rules: readonly string[] = [],
  asOf?: number,
  dates: ReadonlyMap<number, string> = new Map(),
): Promise<Generated> {
  const { value, usage } = await client.structured({
    purpose: 'answer',
    schema: AnswerOutputSchema,
    system: ANSWER_SYSTEM,
    user: buildPrompt(question, candidates, nameOf, rules, asOf, dates),
    maxTokens: 1024,
  });
  const allowed = new Set(candidates.map((fact) => fact.id));
  const { text, cited } = stripUncited(value, allowed);
  return { text, cited, usage };
}

// Pure. Keeps only sentences whose every citation is a candidate id.
export function stripUncited(output: AnswerOutput, allowed: ReadonlySet<number>): { text: string; cited: number[] } {
  const kept = output.sentences.filter(
    (sentence) => sentence.citedIds.length > 0 && sentence.citedIds.every((id) => allowed.has(id)) && sentence.text.trim() !== '',
  );
  if (kept.length === 0) return { text: NO_INFO, cited: [] };
  const cited = [...new Set(kept.flatMap((sentence) => sentence.citedIds))].sort((a, b) => a - b);
  return { text: kept.map((sentence) => sentence.text.trim()).join(' '), cited };
}

// When answering as of a session, "current" means current at that session, and the labels say so.
// dates maps session numbers to calendar dates when the history carries them, so "when" questions
// can be answered with a date instead of a session number.
export function buildPrompt(
  question: string,
  candidates: readonly FactRow[],
  nameOf: NameLookup,
  rules: readonly string[],
  asOf?: number,
  dates: ReadonlyMap<number, string> = new Map(),
): string {
  const lines = candidates.map((fact) => `[${fact.id}] ${label(fact, nameOf, asOf)} quote: "${fact.quote ?? ''}"`);
  const ruleBlock = rules.length === 0 ? '' : `\n\nDerivation rules:\n${rules.map((rule) => `- ${rule}`).join('\n')}`;
  const timeBlock = asOf === undefined ? '' : `\n\nAnswer as of session ${asOf}. "current as of s${asOf}" means true at that time, whatever happened later.`;
  const mentioned = new Set(candidates.flatMap((fact) => [fact.validFrom, ...(fact.validTo === null ? [] : [fact.validTo])]));
  const dated = [...mentioned].filter((session) => dates.has(session)).sort((a, b) => a - b);
  const dateBlock = dated.length === 0 ? '' : `\n\nSession dates: ${dated.map((session) => `s${session} = ${dates.get(session) ?? ''}`).join(', ')}. Use the date, not the session number, when asked when something happened.`;
  return `Facts:\n${lines.join('\n')}${ruleBlock}${timeBlock}${dateBlock}\n\nQuestion: ${question}`;
}

function label(fact: FactRow, nameOf: NameLookup, asOf: number | undefined): string {
  if (asOf === undefined) return renderLine(fact, nameOf);
  const base = renderLine(fact, nameOf).replace(/ \((?:since s\d+|s\d+ to s\d+)\) /, ' ');
  const currentThen = fact.validFrom <= asOf && (fact.validTo === null || fact.validTo > asOf);
  const span = currentThen ? `(current as of s${asOf}, since s${fact.validFrom})` : `(ended at s${fact.validTo ?? '?'}, before s${asOf})`;
  return base.replace(/ \[f\d+\]$/, ` ${span}$&`);
}
