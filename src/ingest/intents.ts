// Pure detection of forget requests inside user text. "Please forget everything about my ex."

import type { ForgetTarget } from '../types.js';

const FORGET =
  /\b(?:forget|delete|erase|remove|wipe)\b\s+(?:everything|all|anything|any memory|all memories|what you know|the details)?\s*(?:about|regarding|of|on)?\s*(.+)/i;

// Words that trail the target and carry no identity.
const TRAILING = /\s*(?:completely|entirely|permanently|forever|please|now|from (?:your )?memory|from memory)\s*$/i;

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
