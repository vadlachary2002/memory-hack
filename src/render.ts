// Profile and session summaries rendered from facts. No model, no storage, same input same text.

import type { FactRow } from './db/facts.repo.js';
import { PREDICATE_NAMES, PREDICATES, type Predicate } from './vocab.js';

export type NameLookup = (entityId: number) => string;

const ORDER = new Map<Predicate, number>(PREDICATE_NAMES.map((name, index) => [name, index]));

// Current durable facts, then facts that stopped being true.
export function renderProfile(facts: readonly FactRow[], nameOf: NameLookup, asOf?: number): string {
  const visible = facts.filter((fact) => fact.erasedAt === null && fact.tier === 'durable');
  const current = visible.filter((fact) => fact.validTo === null).sort(byPredicateThenId);
  const closed = visible.filter((fact) => fact.validTo !== null).sort(byPredicateThenId);
  const lines: string[] = [asOf === undefined ? 'Profile' : `Profile (as of session ${asOf})`];
  if (current.length === 0) lines.push('- nothing known yet');
  for (const fact of current) lines.push(`- ${renderLine(fact, nameOf)}`);
  if (closed.length > 0) {
    lines.push('No longer true:');
    for (const fact of closed) lines.push(`- ${renderLine(fact, nameOf)}`);
  }
  return lines.join('\n');
}

// Facts recorded in one session, scratch included so the user can see what was noted but not kept.
export function renderSession(facts: readonly FactRow[], sessionIdx: number, nameOf: NameLookup): string {
  const rows = facts
    .filter((fact) => fact.erasedAt === null && fact.sessionIdx === sessionIdx)
    .sort(byPredicateThenId);
  const lines: string[] = [`Session ${sessionIdx}`];
  if (rows.length === 0) lines.push('- nothing recorded');
  for (const fact of rows) {
    const tag = fact.tier === 'scratch' ? ' (scratch)' : '';
    lines.push(`- ${renderLine(fact, nameOf)}${tag}`);
  }
  return lines.join('\n');
}

// One line: "lives in Pune (s2 to s18) [f1]". Facts about someone else carry their name: "Kiran: works at TCS".
export function renderLine(fact: FactRow, nameOf: NameLookup): string {
  const phrase = fact.predicate === 'attribute' ? `${fact.attrKey ?? 'attribute'}:` : PREDICATES[fact.predicate].phrase;
  const object = fact.objectEntityId !== null ? nameOf(fact.objectEntityId) : (fact.objectText ?? '[redacted]');
  const span = fact.validTo === null ? `(since s${fact.validFrom})` : `(s${fact.validFrom} to s${fact.validTo})`;
  const subject = nameOf(fact.subjectEntityId);
  const prefix = subject === USER_NAME || subject === '[redacted]' ? '' : `${subject}: `;
  return `${prefix}${phrase} ${object} ${span} [f${fact.id}]`;
}

const USER_NAME = 'user';

function byPredicateThenId(a: FactRow, b: FactRow): number {
  const order = (ORDER.get(a.predicate) ?? 0) - (ORDER.get(b.predicate) ?? 0);
  return order !== 0 ? order : a.id - b.id;
}
