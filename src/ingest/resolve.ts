// Entity canonicalisation: the object of a relational fact becomes an entity with a role.

import type { EntitiesRepo, EntityType } from '../db/entities.repo.js';
import { PREDICATES, type Predicate } from '../vocab.js';
import type { Candidate } from './extract.js';

// The role the object entity gets, as seen from the user.
const ROLE_OF: Partial<Record<Predicate, string>> = {
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
