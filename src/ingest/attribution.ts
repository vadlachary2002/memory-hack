// Who a sentence is about, decided from its grammar in code, so a careless extractor cannot pin
// a colleague's move on the user or a sister's allergy on "me".

import { roleFor } from '../roles.js';

export type Attribution =
  | { kind: 'self' }
  | { kind: 'other'; name: string; role?: string }
  | { kind: 'negated' }
  | { kind: 'unknown' };

const JOINT = /^(?:[A-Z][\p{L}'-]+)\s+and\s+(?:I|me)\b/u;
const MY_ROLE_NAME = /^(?:[Mm]y|[Oo]ur)\s+([a-z]+(?:\s+[a-z]+)?)\s+([A-Z][\p{L}'-]+)\b/u;
const NAME_VERB =
  /^([A-Z][\p{L}'-]+)\s+(moved|lives|lived|works|worked|is|was|has|had|got|joined|relocated|shifted|reports|loves|likes|hates|prefers|can't|cannot|doesn't|started|quit|left)\b/u;
const PRONOUN = /^(she|he|they|her|his|their)\b/i;
const NEGATED = /\b(not|never|no)\s+(allergic|intolerant|vegetarian|vegan|dating|married)\b|\bno allergies\b|\bnothing\b.*\ballergic\b|\ballergic to (nothing|anything)\b/i;
const CAPITALISED = /\b([A-Z][\p{L}'-]{2,})\b/gu;
const NOT_NAMES = new Set(['I', 'Also', 'And', 'But', 'The', 'She', 'He', 'They', 'My', 'Our', 'Unlike', 'Quick', 'Note', 'Sorry', 'Finally', 'Big', 'Update', 'Moved', 'Shifted', 'Relocated', 'Living', 'Settled', 'Transferred', 'Now', 'Still']);

// sentence: the user's sentence the quote sits in. context: the clean text before it, for pronouns.
export function attribute(sentence: string, before: string): Attribution {
  const text = sentence.trim();
  if (NEGATED.test(text) && /\b(I|I'm|I am|me|my)\b/i.test(text) && !PRONOUN.test(text)) return { kind: 'negated' };
  if (JOINT.test(text)) return { kind: 'self' };
  const roleName = MY_ROLE_NAME.exec(text);
  if (roleName && roleName[1] !== undefined && roleName[2] !== undefined) {
    return { kind: 'other', name: roleName[2], role: roleFor(roleName[1]) };
  }
  const nameVerb = NAME_VERB.exec(text);
  if (nameVerb && nameVerb[1] !== undefined && !NOT_NAMES.has(nameVerb[1])) return { kind: 'other', name: nameVerb[1] };
  if (PRONOUN.test(text)) {
    const name = lastName(before);
    return name === undefined ? { kind: 'unknown' } : { kind: 'other', name };
  }
  return { kind: 'self' };
}

function lastName(text: string): string | undefined {
  let found: string | undefined;
  for (const match of text.matchAll(CAPITALISED)) {
    const word = match[1];
    if (word !== undefined && !NOT_NAMES.has(word)) found = word;
  }
  return found;
}
