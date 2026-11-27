// Runs the scored harness and the scenario cases once per model and prints one row each,
// so price and quality sit side by side.
// Run with: npm run compare -- --models claude-haiku-5-5,gemini-3.8-flash [--suite harness|cases|both]

import { createClient, hasAnyKey } from '../src/llm/provider.js';
import { hasFailures, loadCases, runCases, type CaseResult } from './cases.js';
import { loadScript } from './generate.js';
import { scoreOnce, type RunScore } from './score.js';

export type Suite = 'harness' | 'cases' | 'both';

export type Row = { model: string; harness?: RunScore; cases?: CaseResult[]; error?: string };

export async function compare(models: readonly string[], seed: number, suite: Suite = 'both'): Promise<Row[]> {
  const script = loadScript();
  const cases = loadCases();
  const rows: Row[] = [];
  for (const model of models) {
    // Every purpose follows MODEL for the run; per-purpose overrides would defeat the comparison.
    process.env.MODEL = model;
    delete process.env.EXTRACT_MODEL;
    delete process.env.CLASSIFY_MODEL;
    delete process.env.ANSWER_MODEL;
    const row: Row = { model };
    try {
      if (suite !== 'cases') row.harness = await scoreOnce(script, createClient(), seed);
      if (suite !== 'harness') row.cases = await runCases(cases, createClient());
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    }
    rows.push(row);
  }
  return rows;
}

export function formatRows(rows: readonly Row[]): string {
  const lines = ['model                      harness        leak   cost      cases          leak   cost      total'];
  for (const row of rows) {
    if (row.error !== undefined && row.harness === undefined && row.cases === undefined) {
      lines.push(`${row.model.padEnd(26)} error: ${row.error.slice(0, 160)}`);
      continue;
    }
    const h = row.harness;
    const c = row.cases;
    const caseRight = c === undefined ? undefined : c.reduce((n, r) => n + r.verdicts.filter((v) => v.right).length, 0);
    const caseTotal = c === undefined ? undefined : c.reduce((n, r) => n + r.verdicts.length, 0);
    const caseLeak = c === undefined ? undefined : c.reduce((n, r) => n + r.dbLeaks.length + r.verdicts.filter((v) => v.fail === 'leak').length, 0);
    const caseCost = c === undefined ? undefined : c.reduce((n, r) => n + r.cost, 0);
    const cell = (value: string | undefined, width: number): string => (value ?? '-').padEnd(width);
    lines.push(
      `${row.model.padEnd(26)} ${cell(h && `${h.right}/${h.total}`, 14)} ${cell(h && String(h.leak), 6)} ${cell(h && `$${h.cost.toFixed(4)}`, 9)} ` +
        `${cell(caseRight === undefined ? undefined : `${caseRight}/${caseTotal}`, 14)} ${cell(caseLeak === undefined ? undefined : String(caseLeak), 6)} ${cell(caseCost === undefined ? undefined : `$${caseCost.toFixed(4)}`, 9)} ` +
        `$${((h?.cost ?? 0) + (caseCost ?? 0)).toFixed(4)}${row.error === undefined ? '' : `  (partial: ${row.error.slice(0, 80)})`}`,
    );
    if (h !== undefined) {
      for (const verdict of h.verdicts.filter((v) => !v.right)) lines.push(`    FAIL ${verdict.fail?.padEnd(12)} harness/${verdict.id}: ${verdict.text.slice(0, 80)}`);
      if (h.dbLeak) lines.push('    FAIL leak         harness: database still contains a forbidden string after the run');
    }
    if (c !== undefined && hasFailures(c)) {
      for (const result of c) {
        for (const verdict of result.verdicts.filter((v) => !v.right)) lines.push(`    FAIL ${verdict.fail?.padEnd(12)} ${result.id}/${verdict.id}: ${verdict.text.slice(0, 80)}`);
        for (const needle of result.dbLeaks) lines.push(`    FAIL leak         ${result.id}: database still contains a forbidden string (${needle.length} chars)`);
      }
    }
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
  const suite = (option('--suite') ?? 'both') as Suite;
  const rows = await compare(models, Number(option('--seed') ?? 2026), suite);
  console.log(formatRows(rows));
}
