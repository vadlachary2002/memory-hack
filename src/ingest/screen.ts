// The screen step: a cheap model call on paragraphs that code could not place. It decides whether
// the user wrote the text or brought it from elsewhere. Fail closed: no verdict, an unknown index,
// or "mixed" with own words that are not actually in the paragraph all count as pasted.

import { z } from 'zod';
import type { LlmClient, Usage } from '../llm/client.js';
import { SCREEN_SYSTEM } from '../llm/prompts.js';
import { squash } from './extract.js';
import type { Span } from './taint.js';

export const ScreenVerdictSchema = z.object({
  index: z.number().int(),
  kind: z.enum(['own', 'pasted', 'mixed']),
  ownText: z.string().nullable(),
});

export type ScreenVerdict = z.infer<typeof ScreenVerdictSchema>;

export const ScreenSchema = z.object({ verdicts: z.array(ScreenVerdictSchema) });

export type Released = { turnIndex: number; original: string; text: string };

export type ScreenResult = { released: Released[]; usage: Usage };

export async function screenSuspects(client: LlmClient, suspects: readonly Span[]): Promise<ScreenResult> {
  const user = suspects.map((span, at) => `${at + 1}. ${span.text}`).join('\n\n');
  const { value, usage } = await client.structured({ purpose: 'screen', schema: ScreenSchema, system: SCREEN_SYSTEM, user });
  return { released: release(suspects, value.verdicts), usage };
}

// Pure. The verdict can keep a paragraph whole or keep a verbatim part of it; nothing else.
export function release(suspects: readonly Span[], verdicts: readonly ScreenVerdict[]): Released[] {
  const released: Released[] = [];
  suspects.forEach((span, at) => {
    const verdict = verdicts.find((item) => item.index === at + 1);
    if (verdict === undefined || verdict.kind === 'pasted') return;
    if (verdict.kind === 'own') {
      released.push({ turnIndex: span.turnIndex, original: span.text, text: span.text });
      return;
    }
    const own = verdict.ownText?.trim() ?? '';
    if (own === '' || !squash(span.text).includes(squash(own))) return;
    released.push({ turnIndex: span.turnIndex, original: span.text, text: own });
  });
  return released;
}
