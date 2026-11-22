// Pure split of a user turn into the user's own words and pasted third-party text.
// Tainted spans never reach extraction, so a pasted instruction has no path into memory.

import { TAINT_MAX_SPAN_CHARS } from '../config.js';

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

// The text that is safe to persist: clean paragraphs kept, each tainted paragraph replaced by a marker.
export function storableText(text: string): string {
  const parts: string[] = [];
  let poisonedBy: TaintReason | undefined;
  for (const paragraph of paragraphs(text)) {
    const reason = poisonedBy ?? taintReason(paragraph);
    if (reason === 'fence' || reason === 'forwarded') poisonedBy = reason;
    parts.push(reason === undefined ? paragraph : `[pasted content removed: ${reason}]`);
  }
  return parts.join('\n\n');
}

export function taintReason(paragraph: string): TaintReason | undefined {
  if (FENCE.test(paragraph)) return 'fence';
  if (FORWARDED.test(paragraph)) return 'forwarded';
  if (QUOTED_LINE.test(paragraph)) return 'quoted';
  if (URL.test(paragraph)) return 'url';
  if (paragraph.length > TAINT_MAX_SPAN_CHARS) return 'too_long';
  return undefined;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}
