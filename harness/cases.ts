// Scenario cases: small conversations with phrasing variants, run live and graded like the harness.
// Add a case by appending to harness/cases.json. Run with: npm run cases -- [--only <id-prefix>]

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { runBatch, type BatchAnswer } from '../src/adapters/batch.js';
import { AnthropicClient } from '../src/llm/anthropic.js';
import type { LlmClient } from '../src/llm/client.js';
import { Memory } from '../src/memory.js';
import { SessionInputSchema } from '../src/types.js';
import { QuestionSchema, type Question } from './generate.js';
import { grade, type Verdict } from './score.js';

export const CaseSchema = z.object({
  id: z.string(),
  about: z.string(),
  sessions: z.array(SessionInputSchema).min(1),
  questions: z.array(QuestionSchema).min(1),
  // After the named session, none of these strings may exist anywhere in the database.
  forbiddenInDbAfter: z.object({ askAt: z.number().int().positive(), needles: z.array(z.string()).min(1) }).optional(),
});

export type Case = z.infer<typeof CaseSchema>;

export type CaseResult = { id: string; about: string; verdicts: Verdict[]; dbLeaks: string[]; cost: number };

export function loadCases(): Case[] {
  return z.array(CaseSchema).parse(JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')));
}

export async function runCase(item: Case, llm: LlmClient): Promise<CaseResult> {
  const memory = new Memory({ dbPath: ':memory:', llm });
  const batch = await runBatch(memory, item.sessions, item.questions);
  const verdicts = batch.answers.map((answer) => grade(item.questions.find((q) => q.id === answer.id) as Question, answer.answer));
  const dbLeaks: string[] = [];
  if (item.forbiddenInDbAfter !== undefined) {
    for (const needle of item.forbiddenInDbAfter.needles) if (!memory.audit(needle).clean) dbLeaks.push(needle);
  }
  const cost = memory.cost().usd;
  memory.close();
  return { id: item.id, about: item.about, verdicts, dbLeaks, cost };
}

export async function runCases(cases: readonly Case[], llm: LlmClient): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const item of cases) results.push(await runCase(item, llm));
  return results;
}

export function formatResults(results: readonly CaseResult[]): string {
  const lines: string[] = [];
  let passed = 0;
  let total = 0;
  let cost = 0;
  for (const result of results) {
    const failed = result.verdicts.filter((v) => !v.right).length + result.dbLeaks.length;
    lines.push(`${failed === 0 ? 'PASS' : 'FAIL'} ${result.id}  (${result.about})`);
    for (const verdict of result.verdicts) {
      lines.push(`  ${verdict.right ? 'ok  ' : `FAIL ${verdict.fail}`.padEnd(17)} ${verdict.id.padEnd(22)} ${verdict.text.slice(0, 100)}`);
    }
    for (const needle of result.dbLeaks) lines.push(`  FAIL leak            database still contains a forbidden string (id ${needle.length} chars)`);
    passed += result.verdicts.filter((v) => v.right).length;
    total += result.verdicts.length;
    cost += result.cost;
  }
  const leaks = results.reduce((sum, result) => sum + result.dbLeaks.length, 0);
  lines.push(`questions ${passed}/${total} right  db leaks ${leaks}  cost $${cost.toFixed(4)}`);
  return lines.join('\n');
}

export function hasFailures(results: readonly CaseResult[]): boolean {
  return results.some((result) => result.dbLeaks.length > 0 || result.verdicts.some((v) => !v.right));
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
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }
  const only = option('--only');
  const cases = loadCases().filter((item) => only === undefined || item.id.startsWith(only));
  const results = await runCases(cases, new AnthropicClient());
  console.log(formatResults(results));
  process.exitCode = hasFailures(results) ? 1 : 0;
}

export type { BatchAnswer };
