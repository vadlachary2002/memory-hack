// Forget: resolve the target, erase or strip, redact, then prove it with probes and a full scan.
// Every rule here is code. The report carries ids only, never names.

import type { EntitiesRepo, EntityRow } from '../db/entities.repo.js';
import type { FactRow, FactsRepo } from '../db/facts.repo.js';
import type { TurnsRepo } from '../db/turns.repo.js';
import { FORMER } from '../ingest/resolve.js';
import type { AuditReport, ForgetReport, ForgetTarget } from '../types.js';
import { PREDICATES } from '../vocab.js';
import { cleanNeedles, containsName, redactNames } from './names.js';

export type ForgetRepos = { facts: FactsRepo; entities: EntitiesRepo; turns: TurnsRepo };

export type ForgetContext = ForgetRepos & { summarise: () => string; atSession: number };

// Everyday words for a relationship, mapped to the role stored on the entity.
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
};

const LEADING_WORDS = /^(please\s+)?(forget\s+)?(everything\s+|all\s+)?(about\s+)?(my\s+)?/i;

export function forget(ctx: ForgetContext, target: ForgetTarget): ForgetReport {
  switch (target.kind) {
    case 'entity':
      return forgetEntity(ctx, target.name);
    case 'predicate':
      return forgetFacts(ctx, ctx.facts.all().filter((fact) => fact.predicate === target.predicate));
    case 'domain':
      return forgetFacts(ctx, ctx.facts.all().filter((fact) => fact.domains.includes(target.domain)));
  }
}

// Resolve a name, alias, or relationship word to entities. Several matches mean ambiguity.
export function resolveEntities(entities: EntitiesRepo, ref: string): EntityRow[] {
  const cleaned = ref.trim().replace(LEADING_WORDS, '').trim();
  if (cleaned === '') return [];
  const byName = entities.byName(cleaned);
  if (byName) return [byName];
  const role = ROLE_SYNONYMS[cleaned.toLowerCase()] ?? cleaned.toLowerCase();
  return entities.allByRole(role);
}

// Scan every text column and the rendered summary for the needles. Ids only.
export function audit(ctx: ForgetContext, needles: readonly string[]): AuditReport {
  const clean = cleanNeedles(needles);
  const factHits = ctx.facts
    .all()
    .filter((fact) => containsName(fact.objectText, clean) || containsName(fact.quote, clean))
    .map((fact) => fact.id);
  const turnHits = ctx.turns
    .all()
    .filter((turn) => containsName(turn.text, clean))
    .map((turn) => turn.id);
  const entityHits = ctx.entities
    .all()
    .filter((entity) => containsName(entity.canonicalName, clean) || entity.aliases.some((alias) => containsName(alias, clean)))
    .map((entity) => entity.id);
  const summaryHit = containsName(ctx.summarise(), clean);
  return { factHits, turnHits, entityHits, summaryHit, clean: factHits.length + turnHits.length + entityHits.length === 0 && !summaryHit };
}

function forgetEntity(ctx: ForgetContext, name: string): ForgetReport {
  const matches = resolveEntities(ctx.entities, name);
  if (matches.length !== 1) {
    return {
      entityIds: matches.map((entity) => entity.id),
      erasedFacts: [],
      strippedFacts: [],
      redactedTurns: [],
      probes: [{ name: matches.length === 0 ? 'resolved' : 'unambiguous', passed: false }],
      scanClean: matches.length === 0,
    };
  }
  const entity = matches[0] as EntityRow;
  const needles = cleanNeedles([entity.canonicalName, ...entity.aliases]);

  // Erase: facts about the entity, and relational facts pointing at it.
  const owned = ctx.facts.byEntity(entity.id).filter((fact) => isOwned(fact, entity.id));
  const erasedFacts = ctx.facts.eraseByIds(owned.map((fact) => fact.id), ctx.atSession);

  // Strip: facts that only mention the name in passing keep their object, lose the mention.
  const strippedFacts: number[] = [];
  for (const fact of ctx.facts.all()) {
    if (!containsName(fact.quote, needles) && !containsName(fact.objectText, needles)) continue;
    const quote = fact.quote === null ? null : redactNames(fact.quote, needles);
    const objectText = fact.objectText === null ? null : redactNames(fact.objectText, needles);
    ctx.facts.rewriteText(fact.id, objectText, quote);
    strippedFacts.push(fact.id);
  }

  // Redact: raw turns that carry the name.
  const turnIds = ctx.turns
    .all()
    .filter((turn) => containsName(turn.text, needles))
    .map((turn) => turn.id);
  const redactedTurns = ctx.turns.redactByIds(turnIds, ctx.atSession);

  ctx.entities.erase(entity.id, ctx.atSession);

  // Probes: the system asks itself and must come up empty.
  const probes = [
    { name: 'resolve by name', passed: ctx.entities.byName(entity.canonicalName ?? '') === undefined },
    { name: 'resolve by alias', passed: entity.aliases.every((alias) => ctx.entities.byName(alias) === undefined) },
    { name: 'resolve by role', passed: entity.roles.every((role) => !ctx.entities.allByRole(role).some((row) => row.id === entity.id)) },
    { name: 'summary', passed: !containsName(ctx.summarise(), needles) },
  ];
  const scan = audit(ctx, needles);
  return { entityIds: [entity.id], erasedFacts, strippedFacts, redactedTurns, probes, scanClean: scan.clean };
}

// Forget by predicate or domain: erase the facts and redact the turns they came from.
function forgetFacts(ctx: ForgetContext, targets: readonly FactRow[]): ForgetReport {
  const needles = cleanNeedles(targets.map((fact) => fact.objectText));
  const erasedFacts = ctx.facts.eraseByIds(targets.map((fact) => fact.id), ctx.atSession);
  const sourceTurns = targets.map((fact) => fact.sourceTurnId).filter((id): id is number => id !== null);
  const redactedTurns = ctx.turns.redactByIds(sourceTurns, ctx.atSession);
  const scan = audit(ctx, needles);
  return {
    entityIds: [],
    erasedFacts,
    strippedFacts: [],
    redactedTurns,
    probes: [{ name: 'summary', passed: !scan.summaryHit }],
    scanClean: scan.factHits.length === 0 && scan.entityHits.length === 0 && !scan.summaryHit,
  };
}

// Subject-position facts and relational object-position facts belong to the entity.
function isOwned(fact: FactRow, entityId: number): boolean {
  if (fact.subjectEntityId === entityId) return true;
  return fact.objectEntityId === entityId && PREDICATES[fact.predicate].relational;
}
