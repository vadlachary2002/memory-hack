// Pure detection of forget requests inside user text. "Please forget everything about my ex."

import type { ForgetTarget } from '../types.js';

const FORGET =
  /\b(?:forget|delete|erase|remove|wipe)\b\s+(?:everything|all|anything|any memory|all memories|what you know|the details)?\s*(?:about|regarding|of|on)?\s*(.+)/i;

// Words that trail the target and carry no identity.
const TRAILING = /\s*(?:completely|entirely|permanently|forever|please|now|from (?:your )?memory|from memory)\s*$/i;

// Relationship endings stated in plain words. Too important to leave to the extractor's "ended" flag.
export type Ending = { predicate: 'partner_of'; name?: string };

const BREAKUP_WITH_NAME = /\b([A-Z][\p{L}'-]+)\s+and\s+(?:I|me)\s+(?:have\s+)?(?:broke up|split up|are done|are over|separated|divorced|called it off|ended things|parted ways)/u;
const BREAKUP_WITH_NAME_2 = /\b(?:broke up with|split up with|divorced|am done with|ended things with|dumped)\s+([A-Z][\p{L}'-]+)\b/u;
const BREAKUP_PLAIN = /\b(?:we|my (?:partner|wife|husband|girlfriend|boyfriend) and I)\s+(?:have\s+)?(?:broke up|split up|are done|are over|separated|divorced|called it off)\b/i;

export function detectEndings(text: string): Ending[] {
  const endings: Ending[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const named = BREAKUP_WITH_NAME.exec(sentence) ?? BREAKUP_WITH_NAME_2.exec(sentence);
    if (named?.[1] !== undefined) endings.push({ predicate: 'partner_of', name: named[1] });
    else if (BREAKUP_PLAIN.test(sentence)) endings.push({ predicate: 'partner_of' });
  }
  return endings;
}

export function detectForget(text: string): ForgetTarget[] {
  const targets: ForgetTarget[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const match = FORGET.exec(sentence);
    if (!match || match[1] === undefined) continue;
    const name = cleanTarget(match[1]);
    if (name !== '') targets.push({ kind: 'entity', name });
  }
  return targets;
}

// The target ends at the first clause break: "forget my ex completely, I do not want to hear about her".
const CLAUSE_BREAK = /[,;:]|\s+(?:and|but|because|since|so|as|from|then)\s+/i;

function cleanTarget(raw: string): string {
  let name = (raw.split(CLAUSE_BREAK)[0] ?? raw).trim();
  for (let pass = 0; pass < 3; pass += 1) name = name.replace(/[.!?,;:]+$/g, '').replace(TRAILING, '');
  return name.replace(/^(?:about|regarding|of)\s+/i, '').trim();
}
