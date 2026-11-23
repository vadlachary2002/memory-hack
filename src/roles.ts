// The lexicon that turns everyday words into roles and categories.
// Shared by forget (resolve "my ex"), recall (closed-world check on "my sister", anchors on "that dog").

import { FORMER } from './ingest/resolve.js';
import type { Predicate } from './vocab.js';

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
  wife: 'partner',
  husband: 'partner',
  spouse: 'partner',
  girlfriend: 'partner',
  boyfriend: 'partner',
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
  sister: 'sibling',
  brother: 'sibling',
  sis: 'sibling',
  bro: 'sibling',
  parent: 'parent',
  mother: 'parent',
  father: 'parent',
  mom: 'parent',
  mum: 'parent',
  dad: 'parent',
  amma: 'parent',
  appa: 'parent',
  child: 'child',
  son: 'child',
  daughter: 'child',
  kid: 'child',
  baby: 'child',
  // pets
  pet: 'pet',
  dog: 'pet',
  cat: 'pet',
  puppy: 'pet',
  kitten: 'pet',
  pup: 'pet',
  animal: 'pet',
  beagle: 'pet',
};

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
  return (GENERIC_OBJECTS[predicate] ?? []).includes(cleaned) || ROLE_SYNONYMS[cleaned] === roleOfPredicate(predicate);
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
