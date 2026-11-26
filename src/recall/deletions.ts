// "Who did I ask you to forget?" is answered from the deletion log, in code. Kinds and counts, never a name.

import type { DeletionRow } from '../db/deletions.repo.js';
import type { Answer } from '../types.js';

const FORGET_WORDS = /\b(forget|forgot|forgotten|delete|deleted|erase|erased|remove|removed|wipe|wiped)\b/i;
const ASKS = /\b(who|whom|what|which|did|have|has|anything|anyone|someone|ever)\b/i;

export function asksAboutForgetting(question: string): boolean {
  return FORGET_WORDS.test(question) && ASKS.test(question);
}

export function describeDeletions(rows: readonly DeletionRow[]): Answer {
  const base = { cited: [], candidates: [], domains: ['general' as const], abstained: false, cost: 0 };
  if (rows.length === 0) return { ...base, text: 'No. You have not asked me to forget anything.' };
  const sentences = rows.map((row) => `In session ${row.atSession} you asked me to forget ${describe(row)}.`);
  return { ...base, text: `Yes. ${sentences.join(' ')} I no longer know who or what that was; the record keeps only counts.` };
}

function describe(row: DeletionRow): string {
  const facts = `${row.erasedFacts} fact${row.erasedFacts === 1 ? '' : 's'}`;
  switch (row.kind) {
    case 'entity':
      return `${row.entityCount === 1 ? 'one person' : `${row.entityCount} people`} (${facts} erased, ${row.redactedTurns} messages redacted)`;
    case 'predicate':
      return `one kind of fact (${facts} erased)`;
    case 'domain':
      return `one whole topic (${facts} erased)`;
  }
}
