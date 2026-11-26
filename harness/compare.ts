// Runs the scored harness once per model and prints one row each, so price and quality sit side by side.
// Run with: npm run compare -- --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,gemini-3-flash-preview

import { createClient, hasAnyKey } from '../src/llm/provider.js';
import { loadScript } from './generate.js';
import { scoreOnce, type RunScore } from './score.js';

export type Row = { model: string; score?: RunScore; error?: string };

export async function compare(models: readonly string[], seed: number): Promise<Row[]> {
  const script = loadScript();
  const rows: Row[] = [];
  for (const model of models) {
    // Every purpose follows MODEL for the run; per-purpose overrides would defeat the comparison.
    process.env.MODEL = model;
    delete process.env.EXTRACT_MODEL;
    delete process.env.CLASSIFY_MODEL;
    delete process.env.ANSWER_MODEL;
    try {
      rows.push({ model, score: await scoreOnce(script, createClient(), seed) });
    } catch (error) {
      rows.push({ model, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return rows;
}

export function formatRows(rows: readonly Row[]): string {
  const lines = ['model                      right  stale  false  leak   cost'];
  for (const row of rows) {
    if (row.score === undefined) {
      lines.push(`${row.model.padEnd(26)} error: ${row.error ?? 'unknown'}`);
      continue;
    }
    const s = row.score;
    lines.push(
      `${row.model.padEnd(26)} ${`${s.right}/${s.total}`.padEnd(6)} ${String(s.stale).padEnd(6)} ${String(s.falseRecall).padEnd(6)} ${String(s.leak).padEnd(6)} $${s.cost.toFixed(4)}`,
    );
  }
  return lines.join('\n');
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file://').href) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment variables may already be set.
  }
  if (!hasAnyKey()) {
    console.error('set ANTHROPIC_API_KEY or GEMINI_API_KEY');
    process.exit(1);
  }
  const models = (option('--models') ?? 'claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5').split(',').map((m) => m.trim());
  const rows = await compare(models, Number(option('--seed') ?? 2026));
  console.log(formatRows(rows));
}
