// People, pets and the user. Resolution by name, alias or role happens here.

import type { Db } from './connection.js';

export type EntityType = 'user' | 'person' | 'pet' | 'org' | 'place' | 'thing';

export type EntityRow = {
  id: number;
  canonicalName: string | null;
  type: EntityType;
  aliases: string[];
  roles: string[];
  firstSessionIdx: number | null;
  erasedAt: number | null;
};

export type NewEntity = {
  name: string;
  type: EntityType;
  aliases?: readonly string[];
  roles?: readonly string[];
  sessionIdx?: number;
};

type RawRow = {
  id: number;
  canonical_name: string | null;
  type: string;
  aliases_json: string;
  roles_json: string;
  first_session_idx: number | null;
  erased_at: number | null;
};

const USER_NAME = 'user';

export class EntitiesRepo {
  constructor(private readonly db: Db) {}

  // The single user entity, created on first use.
  ensureUser(): number {
    const existing = this.db.prepare("SELECT id FROM entities WHERE type = 'user' LIMIT 1").get() as
      | { id: number }
      | undefined;
    if (existing) return existing.id;
    const info = this.db
      .prepare("INSERT INTO entities (canonical_name, type, roles_json) VALUES (?, 'user', '[\"me\"]')")
      .run(USER_NAME);
    return Number(info.lastInsertRowid);
  }

  // Find by name or alias and merge aliases and roles, or create.
  upsert(input: NewEntity): EntityRow {
    const found = this.byName(input.name);
    if (found) {
      const aliases = merge(found.aliases, input.aliases ?? []);
      const roles = merge(found.roles, input.roles ?? []);
      this.db
        .prepare('UPDATE entities SET aliases_json = ?, roles_json = ? WHERE id = ?')
        .run(JSON.stringify(aliases), JSON.stringify(roles), found.id);
      return { ...found, aliases, roles };
    }
    const info = this.db
      .prepare('INSERT INTO entities (canonical_name, type, aliases_json, roles_json, first_session_idx) VALUES (?, ?, ?, ?, ?)')
      .run(
        input.name.trim(),
        input.type,
        JSON.stringify(merge([], input.aliases ?? [])),
        JSON.stringify(merge([], input.roles ?? [])),
        input.sessionIdx ?? null,
      );
    const row = this.byId(Number(info.lastInsertRowid));
    if (!row) throw new Error('entity insert failed');
    return row;
  }

  // Resolve a reference by canonical name, alias, or role. Non-erased only.
  resolve(ref: string): EntityRow | undefined {
    return this.byName(ref) ?? this.byRole(ref);
  }

  byName(name: string): EntityRow | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM entities WHERE erased_at IS NULL AND (lower(canonical_name) = lower(@name)
         OR EXISTS (SELECT 1 FROM json_each(entities.aliases_json) WHERE lower(json_each.value) = lower(@name)))
         ORDER BY id LIMIT 1`,
      )
      .get({ name: name.trim() }) as RawRow | undefined;
    return row ? toRow(row) : undefined;
  }

  byRole(role: string): EntityRow | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM entities WHERE erased_at IS NULL
         AND EXISTS (SELECT 1 FROM json_each(entities.roles_json) WHERE lower(json_each.value) = lower(?))
         ORDER BY id LIMIT 1`,
      )
      .get(role.trim()) as RawRow | undefined;
    return row ? toRow(row) : undefined;
  }

  byId(id: number): EntityRow | undefined {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as RawRow | undefined;
    return row ? toRow(row) : undefined;
  }

  all(includeErased = false): EntityRow[] {
    const erased = includeErased ? '' : 'WHERE erased_at IS NULL';
    const rows = this.db.prepare(`SELECT * FROM entities ${erased} ORDER BY id`).all() as RawRow[];
    return rows.map(toRow);
  }

  setRoles(id: number, roles: readonly string[]): void {
    this.db.prepare('UPDATE entities SET roles_json = ? WHERE id = ?').run(JSON.stringify(merge([], roles)), id);
  }

  // Display name for rendering; erased entities render as a placeholder.
  nameOf(id: number): string {
    const row = this.byId(id);
    return row?.canonicalName ?? '[redacted]';
  }
}

function merge(base: readonly string[], extra: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of [...base, ...extra]) {
    const key = value.trim().toLowerCase();
    if (key !== '' && !seen.has(key)) seen.set(key, value.trim());
  }
  return [...seen.values()];
}

function toRow(raw: RawRow): EntityRow {
  return {
    id: raw.id,
    canonicalName: raw.canonical_name,
    type: raw.type as EntityType,
    aliases: JSON.parse(raw.aliases_json) as string[],
    roles: JSON.parse(raw.roles_json) as string[],
    firstSessionIdx: raw.first_session_idx,
    erasedAt: raw.erased_at,
  };
}
