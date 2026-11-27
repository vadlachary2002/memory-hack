// Model ids, prices and thresholds. Everything tunable lives here.

export type Purpose = 'extract' | 'classify' | 'answer';

// USD per million tokens.
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_DB_PATH = 'data/memory.db';

// Spans longer than this inside a user turn are treated as pasted third-party text.
export const TAINT_MAX_SPAN_CHARS = 400;

// Upper bound on facts handed to the answer call.
export const MAX_CANDIDATES = 12;

// Anthropic: cache write is billed at 1.25x input, cache read at roughly 5 to 10 percent.
// Gemini: list prices as of Nov 2026; cached-token discount approximated at 10 percent of input.
export const PRICES_PER_MTOK: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gemini-3-flash-preview': { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  'gemini-3.1-pro-preview': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  'gemini-4-argon': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
  'gemini-4-carbon': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
};

const FALLBACK_PRICE: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const FALLBACK_GEMINI_PRICE: Price = { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 };
// Flash-Lite list prices were not verifiable on Google's pages; this is the published tier estimate.
const FALLBACK_GEMINI_LITE_PRICE: Price = { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 };

type Env = Record<string, string | undefined>;

// Per-purpose override first (EXTRACT_MODEL), then MODEL, then a default chosen by which key exists.
export function modelFor(purpose: Purpose, env: Env = process.env): string {
  const specific = nonEmpty(env[`${purpose.toUpperCase()}_MODEL`]);
  return specific ?? nonEmpty(env.MODEL) ?? defaultModel(env);
}

// Anthropic when its key is present, else Gemini when only that key is present, else Anthropic.
export function defaultModel(env: Env = process.env): string {
  if (nonEmpty(env.ANTHROPIC_API_KEY) === undefined && nonEmpty(env.GEMINI_API_KEY) !== undefined) return DEFAULT_GEMINI_MODEL;
  return DEFAULT_MODEL;
}

export function priceFor(model: string): Price {
  const known = PRICES_PER_MTOK[model];
  if (known !== undefined) return known;
  const name = model.toLowerCase();
  if (!name.startsWith('gemini')) return FALLBACK_PRICE;
  return name.includes('lite') ? FALLBACK_GEMINI_LITE_PRICE : FALLBACK_GEMINI_PRICE;
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
