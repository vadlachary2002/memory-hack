// Entity canonicalisation: the object of a relational fact becomes an entity with a role.

import type { EntitiesRepo, EntityType } from '../db/entities.repo.js';
import type { FactsRepo } from '../db/facts.repo.js';
import { PREDICATES, type Predicate } from '../vocab.js';
import type { Candidate } from './extract.js';

export const FORMER = 'former ';

// The role the object entity gets, as seen from the user.
export const ROLE_OF: Partial<Record<Predicate, string>> = {
  partner_of: 'partner',
  reports_to: 'manager',
  expense_approver: 'approver',
  sibling_of: 'sibling',
  parent_of: 'child',
  child_of: 'parent',
  friend_of: 'friend',
  adopted_pet: 'pet',
};

// Returns the entity id when the candidate's object is a person or pet, else undefined.
export function resolveObject(entities: EntitiesRepo, candidate: Candidate, sessionIdx: number): number | undefined {
  const spec = PREDICATES[candidate.predicate];
  if (!spec.relational && !candidate.objectIsEntity) return undefined;
  const type: EntityType = candidate.entityType ?? (candidate.predicate === 'adopted_pet' ? 'pet' : 'person');
  const role = ROLE_OF[candidate.predicate];
  const row = entities.upsert({
    name: candidate.object,
    type,
    aliases: candidate.aliases,
    roles: role === undefined ? [] : [role],
    sessionIdx,
  });
  return row.id;
}

// When a functional relational fact is superseded, the previous person becomes "former <role>".
export function markSupersededFormer(
  entities: EntitiesRepo,
  facts: FactsRepo,
  supersededIds: readonly number[],
  predicate: Predicate,
  newObjectEntityId: number | undefined,
): void {
  if (!PREDICATES[predicate].relational) return;
  for (const id of supersededIds) {
    const old = facts.byId(id);
    if (old?.objectEntityId == null || old.objectEntityId === newObjectEntityId) continue;
    markFormer(entities, old.objectEntityId, predicate);
  }
}

// When a relational fact closes, the entity's role for that predicate becomes "former <role>".
export function markFormer(entities: EntitiesRepo, entityId: number, predicate: Predicate): void {
  const role = ROLE_OF[predicate];
  const row = entities.byId(entityId);
  if (role === undefined || row === undefined) return;
  const roles = row.roles.filter((value) => value.toLowerCase() !== role).concat(`${FORMER}${role}`);
  entities.setRoles(entityId, roles);
}
