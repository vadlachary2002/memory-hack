// Need-to-know selection and the closed-world check. Pure code, no model.

import { MAX_CANDIDATES } from '../config.js';
import type { EntitiesRepo, EntityRow } from '../db/entities.repo.js';
import type { FactRow, FactsRepo } from '../db/facts.repo.js';
import { FORMER } from '../ingest/resolve.js';
import { isGenericObject, isRoleWord, normaliseRef, roleFor } from '../roles.js';
import { reachableDomains } from '../vocab.js';
import type { Classification } from './classify.js';

export type AbstainReason = 'unknown_name' | 'unknown_role' | 'unknown_anchor';

export type Selection = {
  candidates: FactRow[];
  // Set when the question names someone, some role, or some event the ledger has never seen.
  abstain?: AbstainReason;
  entityIds: number[];
  // The session the question is answered as of; set by the caller or resolved from a time anchor.
  asOf?: number;
  anchorId?: number;
};

export type SelectRepos = { facts: FactsRepo; entities: EntitiesRepo };

export function select(repos: SelectRepos, classification: Classification, asOfInput?: number): Selection {
  const entityIds: number[] = [];
  let asOf = asOfInput;

  // Closed world: every name and every role must resolve, or we answer nothing.
  // A "name" that is really a category word ("dog", "boss") is resolved as a role.
  for (const name of classification.names) {
    const entity = repos.entities.byName(normaliseRef(name)) ?? repos.entities.byName(name);
    if (entity !== undefined) {
      entityIds.push(entity.id);
      continue;
    }
    if (!isRoleWord(name)) return { candidates: [], abstain: 'unknown_name', entityIds, asOf };
    const rows = holdersOf(repos, roleFor(name));
    if (rows.length === 0) return { candidates: [], abstain: 'unknown_name', entityIds, asOf };
    for (const row of rows) entityIds.push(row.id);
  }
  for (const role of classification.roles) {
    const rows = holdersOf(repos, roleFor(role));
    if (rows.length === 0) return { candidates: [], abstain: 'unknown_role', entityIds, asOf };
    for (const row of rows) entityIds.push(row.id);
  }

  // Time anchor: "when I got Bruno" becomes the session the adopted_pet fact started.
  const anchor = classification.timeAnchor === null ? undefined : findAnchor(repos, classification.timeAnchor);
  if (classification.timeAnchor !== null && anchor === undefined) {
    return { candidates: [], abstain: 'unknown_anchor', entityIds, asOf };
  }
  if (anchor !== undefined) asOf = anchor.validFrom;

  // Domain candidates come from one hop of adjacency; entity candidates from direct mentions.
  const byId = new Map<number, FactRow>();
  if (anchor !== undefined) byId.set(anchor.id, anchor);
  for (const fact of repos.facts.byDomains(reachableDomains(classification.domains), asOf)) byId.set(fact.id, fact);
  for (const id of new Set(entityIds)) {
    for (const fact of repos.facts.byEntity(id)) {
      if (fact.tier !== 'durable' || !validAt(fact, asOf)) continue;
      byId.set(fact.id, fact);
    }
  }
  const candidates = [...byId.values()]
    .sort((a, b) => b.validFrom - a.validFrom || b.id - a.id)
    .slice(0, MAX_CANDIDATES);
  return { candidates, entityIds: [...new Set(entityIds)], asOf, anchorId: anchor?.id };
}

// Current holders of a role; failing that, former holders, so "who is my partner" after a breakup
// hands the closed fact to the answer step instead of abstaining.
function holdersOf(repos: SelectRepos, role: string): EntityRow[] {
  const current = repos.entities.allByRole(role);
  if (current.length > 0 || role.startsWith(FORMER)) return current;
  return repos.entities.allByRole(`${FORMER}${role}`);
}

// The anchor fact: same predicate, matched by name, alias, or a generic word for the category
// ("that dog" matches any adopted_pet). Earliest fact wins, which is what "when I got the dog" means.
function findAnchor(repos: SelectRepos, anchor: NonNullable<Classification['timeAnchor']>): FactRow | undefined {
  const needle = normaliseRef(anchor.object);
  const generic = isGenericObject(anchor.predicate, needle);
  const matches = repos.facts
    .all()
    .filter((fact) => fact.predicate === anchor.predicate)
    .filter((fact) => generic || mentions(repos, fact, needle))
    .sort((a, b) => a.validFrom - b.validFrom);
  return matches[0];
}

function mentions(repos: SelectRepos, fact: FactRow, needle: string): boolean {
  const object = (fact.objectText ?? '').toLowerCase();
  if (object.includes(needle)) return true;
  if (fact.objectEntityId === null) return false;
  const entity = repos.entities.byId(fact.objectEntityId);
  if (entity === undefined) return false;
  return [entity.canonicalName ?? '', ...entity.aliases].some((name) => name.toLowerCase().includes(needle));
}

// Entity-matched facts may be closed (the question named the person), but must exist at asOf.
function validAt(fact: FactRow, asOf: number | undefined): boolean {
  if (asOf === undefined) return true;
  return fact.validFrom <= asOf;
}
