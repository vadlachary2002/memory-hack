// Model ids, prices and thresholds. Everything tunable lives here.

export type Purpose = 'extract' | 'classify' | 'answer';

// USD per million tokens.
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_DB_PATH = 'data/memory.db';

// Spans longer than this inside a user turn are treated as pasted third-party text.
export const TAINT_MAX_SPAN_CHARS = 400;

// Upper bound on facts handed to the answer call.
export const MAX_CANDIDATES = 12;

// Cache write is billed at 1.25x input on current models; cache read at roughly 5 to 10 percent.
export const PRICES_PER_MTOK: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const FALLBACK_PRICE: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

// Per-purpose override first (EXTRACT_MODEL), then MODEL, then the default.
export function modelFor(purpose: Purpose): string {
  const specific = nonEmpty(process.env[`${purpose.toUpperCase()}_MODEL`]);
  return specific ?? nonEmpty(process.env.MODEL) ?? DEFAULT_MODEL;
}

export function priceFor(model: string): Price {
  return PRICES_PER_MTOK[model] ?? FALLBACK_PRICE;
}

export function dbPath(): string {
  return nonEmpty(process.env.DB_PATH) ?? DEFAULT_DB_PATH;
}

// One database file per user. Isolation is a file boundary, not a WHERE clause.
export const DEFAULT_USERS_DIR = 'data/users';

const MAX_USER_ID_CHARS = 64;

export function dbPathForUser(userId: string, dir: string = DEFAULT_USERS_DIR): string {
  const safe = userId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, MAX_USER_ID_CHARS);
  if (safe === '' || safe === '_') throw new Error(`invalid user id "${userId}"`);
  return `${dir}/${safe}.db`;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
}
