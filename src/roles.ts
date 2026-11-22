// Everyday relationship words mapped to the roles stored on entities.
// Shared by forget (resolve "my ex") and recall (closed-world check on "my sister").

import { FORMER } from './ingest/resolve.js';

const ROLE_SYNONYMS: Record<string, string> = {
  ex: `${FORMER}partner`,
  'ex-partner': `${FORMER}partner`,
  'ex-girlfriend': `${FORMER}partner`,
  'ex-boyfriend': `${FORMER}partner`,
  'ex-wife': `${FORMER}partner`,
  'ex-husband': `${FORMER}partner`,
  'former partner': `${FORMER}partner`,
  partner: 'partner',
  wife: 'partner',
  husband: 'partner',
  spouse: 'partner',
  girlfriend: 'partner',
  boyfriend: 'partner',
  manager: 'manager',
  boss: 'manager',
  'ex-manager': `${FORMER}manager`,
  'ex-boss': `${FORMER}manager`,
  'old manager': `${FORMER}manager`,
  'previous manager': `${FORMER}manager`,
  'former manager': `${FORMER}manager`,
  approver: 'approver',
  friend: 'friend',
  'ex-friend': `${FORMER}friend`,
  'former friend': `${FORMER}friend`,
  sibling: 'sibling',
  sister: 'sibling',
  brother: 'sibling',
  parent: 'parent',
  mother: 'parent',
  father: 'parent',
  mom: 'parent',
  dad: 'parent',
  child: 'child',
  son: 'child',
  daughter: 'child',
  kid: 'child',
  pet: 'pet',
  dog: 'pet',
  cat: 'pet',
  puppy: 'pet',
};

const LEADING_WORDS = /^(please\s+)?(forget\s+)?(everything\s+|all\s+)?(about\s+)?(my\s+|the\s+)?/i;

// "my ex" -> "former partner", "Sister" -> "sibling", unknown words pass through lowercased.
export function roleFor(word: string): string {
  const cleaned = stripLeading(word).toLowerCase();
  return ROLE_SYNONYMS[cleaned] ?? cleaned;
}

export function stripLeading(ref: string): string {
  return ref.trim().replace(LEADING_WORDS, '').trim();
}
