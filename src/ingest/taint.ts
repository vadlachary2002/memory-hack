// Pure split of a user turn into the user's own words and pasted third-party text.
// Tainted spans never reach extraction, so a pasted instruction has no path into memory.

import { TAINT_MAX_SPAN_CHARS } from '../config.js';

// "too_long" is a suspicion, not a verdict: a long paragraph of ordinary sentences is speech and is
// kept; only a run of text with no sentence breaks for longer than the limit is held back for the
// screen step, which may release it (see ingest/screen.ts).
export type TaintReason = 'fence' | 'url' | 'quoted' | 'forwarded' | 'too_long';

export type Span = { turnIndex: number; text: string; reason?: TaintReason };

export type SplitResult = { clean: Span[]; tainted: Span[] };

const FENCE = /```/;
const URL = /https?:\/\/\S+|www\.\S+/i;
const QUOTED_LINE = /^\s*>/m;
// Email and chat headers that mark the start of someone else's text.
const FORWARDED = /^\s*(from|to|cc|subject|sent|date|forwarded message|-{3,}\s*forwarded)\s*:/im;

// Paragraphs are the unit. A fence or a forwarded header taints everything after it.
export function splitTurn(turnIndex: number, text: string): SplitResult {
  const result: SplitResult = { clean: [], tainted: [] };
  let poisonedBy: TaintReason | undefined;
  for (const paragraph of paragraphs(text)) {
    const reason = poisonedBy ?? taintReason(paragraph);
    if (reason === 'fence' || reason === 'forwarded') poisonedBy = reason;
    if (reason === undefined) result.clean.push({ turnIndex, text: paragraph });
    else result.tainted.push({ turnIndex, text: paragraph, reason });
  }
  return result;
}

// Sentences addressed to the assistant or phrased as commands are never persisted either.
const INSTRUCTION_SENTENCE =
  /\b(the assistant|the ai|the bot|system prompt|as an ai|from now on|always (say|answer|tell|reply|respond)|never (say|mention|tell)|ignore (any |all )?(earlier|previous|prior) instructions|you (must|should|need to|have to|will))\b|^(please\s+)?(send|pay|transfer|wire|deposit|remember (to|not to)|note to|instruction)\b/i;

// The text that is safe to persist: clean paragraphs kept, each tainted paragraph replaced by a marker,
// and each instruction-shaped sentence inside a clean paragraph replaced too. `released` maps a
// suspect paragraph to the part of it the screen step found to be the user's own words.
export function storableText(text: string, released: ReadonlyMap<string, string> = new Map()): string {
  const parts: string[] = [];
  let poisonedBy: TaintReason | undefined;
  for (const paragraph of paragraphs(text)) {
    const reason = poisonedBy ?? taintReason(paragraph);
    if (reason === 'fence' || reason === 'forwarded') poisonedBy = reason;
    const own = reason === 'too_long' ? released.get(paragraph) : undefined;
    if (reason === undefined) parts.push(dropInstructions(paragraph));
    else if (own !== undefined) parts.push(dropInstructions(own));
    else parts.push(`[pasted content removed: ${reason}]`);
  }
  return parts.join('\n\n');
}

export function dropInstructions(paragraph: string): string {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => (INSTRUCTION_SENTENCE.test(sentence.trim()) ? '[instruction removed]' : sentence))
    .join(' ');
}

export function taintReason(paragraph: string): TaintReason | undefined {
  if (FENCE.test(paragraph)) return 'fence';
  if (FORWARDED.test(paragraph)) return 'forwarded';
  if (QUOTED_LINE.test(paragraph)) return 'quoted';
  if (URL.test(paragraph)) return 'url';
  if (paragraph.length > TAINT_MAX_SPAN_CHARS && !readsAsSpeech(paragraph)) return 'too_long';
  return undefined;
}

// Dictated or typed speech breaks into sentences well under the limit. Pasted logs, JSON, signatures
// and headerless emails do not: at least one stretch runs past the limit with no sentence end.
export function readsAsSpeech(paragraph: string): boolean {
  return sentences(paragraph).every((sentence) => sentence.length <= TAINT_MAX_SPAN_CHARS);
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}
