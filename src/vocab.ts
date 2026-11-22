// Closed predicate vocabulary and domain adjacency. The flags here are the rules;
// the model only ever picks a label from this list.

export const DOMAINS = [
  'location',
  'work',
  'finance',
  'health',
  'food',
  'dining',
  'travel',
  'gifts',
  'relationships',
  'family',
  'pets',
  'home',
  'weather',
  'preferences',
  'tech',
  'general',
] as const;

export type Domain = (typeof DOMAINS)[number];

export type Tier = 'durable' | 'scratch';

export type PredicateSpec = {
  // One open value per subject (and attr_key) at a time; a new value closes the old row.
  functional: boolean;
  // Eligible for recall. Ephemeral predicates are never durable.
  durable: boolean;
  // The object is an entity (person or pet), not free text.
  relational: boolean;
  // Lands in the scratch tier and is excluded from recall.
  ephemeral: boolean;
  // Default domain tags; extraction may add more.
  domains: readonly Domain[];
  // Render phrase for summaries.
  phrase: string;
};

export const PREDICATES = {
  lives_in: spec(true, false, ['location'], 'lives in'),
  works_at: spec(true, false, ['work'], 'works at'),
  reports_to: spec(true, true, ['work'], 'reports to'),
  expense_approver: spec(true, true, ['work', 'finance'], 'expenses approved by'),
  allergic_to: spec(false, false, ['health'], 'allergic to'),
  dietary: spec(false, false, ['health', 'food'], 'diet'),
  partner_of: spec(true, true, ['relationships'], 'partner'),
  sibling_of: spec(false, true, ['family'], 'sibling'),
  parent_of: spec(false, true, ['family'], 'parent of'),
  child_of: spec(false, true, ['family'], 'child of'),
  friend_of: spec(false, true, ['relationships'], 'friend'),
  adopted_pet: spec(false, false, ['pets', 'home'], 'adopted pet'),
  prefers: spec(false, false, ['preferences'], 'prefers'),
  dislikes: spec(false, false, ['preferences'], 'dislikes'),
  // Open escape hatch: free-text key, functional per key.
  attribute: spec(true, false, ['general'], 'attribute'),
  searched_for: ephemeral(['travel'], 'searched for'),
  considered: ephemeral(['general'], 'considered'),
  started_project: ephemeral(['work'], 'started project'),
} as const satisfies Record<string, PredicateSpec>;

export type Predicate = keyof typeof PREDICATES;

export const PREDICATE_NAMES = Object.keys(PREDICATES) as Predicate[];

// Which fact domains a question in the key domain may see, besides itself.
export const ADJACENCY: Record<Domain, readonly Domain[]> = {
  location: ['travel', 'weather'],
  work: ['finance'],
  finance: ['work'],
  health: ['food', 'dining', 'travel', 'gifts'],
  food: ['dining', 'health', 'preferences'],
  dining: ['food', 'health', 'preferences'],
  travel: ['location', 'health', 'pets', 'family'],
  gifts: ['preferences', 'relationships', 'family'],
  relationships: ['family', 'gifts', 'home'],
  family: ['relationships'],
  pets: ['home', 'travel'],
  home: ['pets', 'location'],
  weather: ['location'],
  preferences: ['food', 'dining', 'gifts', 'tech'],
  tech: ['preferences'],
  general: [],
};

// Question domains expanded by one hop of adjacency, including themselves.
export function reachableDomains(from: readonly Domain[]): Domain[] {
  const out = new Set<Domain>();
  for (const domain of from) {
    out.add(domain);
    for (const neighbour of ADJACENCY[domain]) out.add(neighbour);
  }
  return [...out];
}

export function isPredicate(value: string): value is Predicate {
  return Object.hasOwn(PREDICATES, value);
}

export function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

export function specOf(predicate: Predicate): PredicateSpec {
  return PREDICATES[predicate];
}

export function tierOf(predicate: Predicate): Tier {
  return PREDICATES[predicate].ephemeral ? 'scratch' : 'durable';
}

function spec(functional: boolean, relational: boolean, domains: readonly Domain[], phrase: string): PredicateSpec {
  return { functional, durable: true, relational, ephemeral: false, domains, phrase };
}

function ephemeral(domains: readonly Domain[], phrase: string): PredicateSpec {
  return { functional: false, durable: false, relational: false, ephemeral: true, domains, phrase };
}
