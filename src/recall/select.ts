// Need-to-know selection and the closed-world check. Pure code, no model.

import { MAX_CANDIDATES } from '../config.js';
import type { EntitiesRepo } from '../db/entities.repo.js';
import type { FactRow, FactsRepo } from '../db/facts.repo.js';
import { roleFor } from '../roles.js';
import { reachableDomains } from '../vocab.js';
import type { Classification } from './classify.js';

export type AbstainReason = 'unknown_name' | 'unknown_role';

export type Selection = {
  candidates: FactRow[];
  // Set when the question names someone or some role the ledger has never seen.
  abstain?: AbstainReason;
  entityIds: number[];
  asOf?: number;
};

export type SelectRepos = { facts: FactsRepo; entities: EntitiesRepo };

export function select(repos: SelectRepos, classification: Classification, asOf?: number): Selection {
  const entityIds: number[] = [];

  // Closed world: every name and every role must resolve, or we answer nothing.
  for (const name of classification.names) {
    const entity = repos.entities.byName(name);
    if (entity === undefined) return { candidates: [], abstain: 'unknown_name', entityIds, asOf };
    entityIds.push(entity.id);
  }
  for (const role of classification.roles) {
    const rows = repos.entities.allByRole(roleFor(role));
    if (rows.length === 0) return { candidates: [], abstain: 'unknown_role', entityIds, asOf };
    for (const row of rows) entityIds.push(row.id);
  }

  // Domain candidates come from one hop of adjacency; entity candidates from direct mentions.
  const byId = new Map<number, FactRow>();
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
  return { candidates, entityIds: [...new Set(entityIds)], asOf };
}

// Entity-matched facts may be closed (the question named the person), but must exist at asOf.
function validAt(fact: FactRow, asOf: number | undefined): boolean {
  if (asOf === undefined) return true;
  return fact.validFrom <= asOf;
}
