// The lexicon that turns everyday words into roles and categories.
// Shared by forget (resolve "my ex"), recall (closed-world check on "my sister", anchors on "that dog").

import type { Predicate } from './vocab.js';

// Prefix on a role once the relationship has ended: "former partner".
export const FORMER = 'former ';

// Specific roles: a word that names a kind within a category. "dog" is a pet, but only a dog is a dog.
// Entities get these from the words around them at ingest; a question word matches only its own kind.
export const GENERIC_OF: Record<string, string> = {
  dog: 'pet',
  cat: 'pet',
  wife: 'partner',
  husband: 'partner',
  girlfriend: 'partner',
  boyfriend: 'partner',
  sister: 'sibling',
  brother: 'sibling',
  mother: 'parent',
  father: 'parent',
  son: 'child',
  daughter: 'child',
};

// Words in a turn that reveal a specific role for the entity being stored.
export const SPECIFIC_ROLE_WORDS: Record<string, RegExp> = {
  dog: /\b(dog|puppy|pup|beagle|labrador|retriever|husky|pug|indie)\b/i,
  cat: /\b(cat|kitten|kitty)\b/i,
  wife: /\b(wife)\b/i,
  husband: /\b(husband)\b/i,
  girlfriend: /\b(girlfriend|gf)\b/i,
  boyfriend: /\b(boyfriend|bf)\b/i,
  sister: /\b(sister|sis)\b/i,
  brother: /\b(brother|bro)\b/i,
  mother: /\b(mother|mom|mum|amma|ma)\b/i,
  father: /\b(father|dad|appa|papa)\b/i,
  son: /\b(son)\b/i,
  daughter: /\b(daughter)\b/i,
};

const ROLE_SYNONYMS: Record<string, string> = {
  // partners
  ex: `${FORMER}partner`,
  'ex-partner': `${FORMER}partner`,
  'ex-girlfriend': `${FORMER}partner`,
  'ex-boyfriend': `${FORMER}partner`,
  'ex-wife': `${FORMER}partner`,
  'ex-husband': `${FORMER}partner`,
  'former partner': `${FORMER}partner`,
  'old partner': `${FORMER}partner`,
  partner: 'partner',
  wife: 'wife',
  husband: 'husband',
  spouse: 'partner',
  girlfriend: 'girlfriend',
  boyfriend: 'boyfriend',
  gf: 'girlfriend',
  bf: 'boyfriend',
  fiance: 'partner',
  fiancee: 'partner',
  'significant other': 'partner',
  // managers
  manager: 'manager',
  boss: 'manager',
  lead: 'manager',
  'team lead': 'manager',
  supervisor: 'manager',
  reporting: 'manager',
  'ex-manager': `${FORMER}manager`,
  'ex-boss': `${FORMER}manager`,
  'old manager': `${FORMER}manager`,
  'old boss': `${FORMER}manager`,
  'previous manager': `${FORMER}manager`,
  'former manager': `${FORMER}manager`,
  'former boss': `${FORMER}manager`,
  approver: 'approver',
  // friends
  friend: 'friend',
  bestie: 'friend',
  buddy: 'friend',
  mate: 'friend',
  'best friend': 'friend',
  'ex-friend': `${FORMER}friend`,
  'former friend': `${FORMER}friend`,
  'old friend': 'friend',
  // family
  sibling: 'sibling',
  sister: 'sister',
  brother: 'brother',
  sis: 'sister',
  bro: 'brother',
  parent: 'parent',
  mother: 'mother',
  father: 'father',
  mom: 'mother',
  mum: 'mother',
  dad: 'father',
  amma: 'mother',
  appa: 'father',
  child: 'child',
  son: 'son',
  daughter: 'daughter',
  kid: 'child',
  baby: 'child',
  // pets
  pet: 'pet',
  dog: 'dog',
  cat: 'cat',
  puppy: 'dog',
  pup: 'dog',
  beagle: 'dog',
  kitten: 'cat',
  kitty: 'cat',
  animal: 'pet',
};

// Specific roles implied by the words around an entity, limited to the category its predicate gives.
export function specificRolesIn(text: string, generic: string | undefined): string[] {
  if (generic === undefined) return [];
  return Object.entries(SPECIFIC_ROLE_WORDS)
    .filter(([role, pattern]) => GENERIC_OF[role] === generic && pattern.test(text))
    .map(([role]) => role);
}

// Past markers in a question mean former holders of a role are wanted too: "who was my old boss".
const PAST_MARKER = /\b(old|former|previous|prior|ex|earlier|before|first|was|were|used to)\b/i;

export function asksAboutPast(question: string): boolean {
  return PAST_MARKER.test(question);
}

// Generic words that stand for "the thing this predicate is about": "when I got the dog".
const GENERIC_OBJECTS: Partial<Record<Predicate, readonly string[]>> = {
  adopted_pet: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'pup', 'animal', 'beagle'],
  lives_in: ['home', 'house', 'place', 'city', 'town', 'flat', 'apartment', 'there'],
  works_at: ['job', 'work', 'company', 'office', 'employer', 'role'],
  reports_to: ['manager', 'boss', 'lead', 'supervisor'],
  expense_approver: ['approver'],
  partner_of: ['partner', 'boyfriend', 'girlfriend', 'wife', 'husband', 'spouse', 'relationship'],
  sibling_of: ['sibling', 'sister', 'brother'],
  parent_of: ['child', 'kid', 'son', 'daughter', 'baby'],
  child_of: ['parent', 'mother', 'father', 'mom', 'dad'],
  friend_of: ['friend'],
  started_project: ['project', 'side project', 'app', 'thing'],
  searched_for: ['trip', 'flight', 'flights', 'hotel', 'search'],
  allergic_to: ['allergy', 'allergies'],
  dietary: ['diet'],
  prefers: ['preference', 'preferences'],
  dislikes: ['dislike', 'dislikes'],
};

const LEADING_WORDS = /^(please\s+)?(forget\s+)?(everything\s+|all\s+)?(about\s+)?(my\s+|the\s+|that\s+|this\s+|our\s+|a\s+|an\s+)?/i;

// "my ex" -> "former partner", "Sister" -> "sibling", unknown words pass through lowercased.
export function roleFor(word: string): string {
  const cleaned = normaliseRef(word);
  return ROLE_SYNONYMS[cleaned] ?? cleaned;
}

// True when the word is a relationship or category word rather than a name.
export function isRoleWord(word: string): boolean {
  return Object.hasOwn(ROLE_SYNONYMS, normaliseRef(word));
}

// True when the word is a generic stand-in for any object of the predicate.
export function isGenericObject(predicate: Predicate, word: string): boolean {
  const cleaned = normaliseRef(word);
  if (cleaned === '') return true;
  const role = ROLE_SYNONYMS[cleaned];
  const generic = role === undefined ? undefined : (GENERIC_OF[role] ?? role);
  return (GENERIC_OBJECTS[predicate] ?? []).includes(cleaned) || generic === roleOfPredicate(predicate);
}

// Lowercase, leading articles and "my" removed, trailing possessive removed.
export function normaliseRef(ref: string): string {
  return stripLeading(ref)
    .toLowerCase()
    .replace(/['’]s$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripLeading(ref: string): string {
  return ref.trim().replace(LEADING_WORDS, '').trim();
}

function roleOfPredicate(predicate: Predicate): string | undefined {
  const byPredicate: Partial<Record<Predicate, string>> = {
    adopted_pet: 'pet',
    partner_of: 'partner',
    reports_to: 'manager',
    sibling_of: 'sibling',
    parent_of: 'child',
    child_of: 'parent',
    friend_of: 'friend',
  };
  return byPredicate[predicate];
}
