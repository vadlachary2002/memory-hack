// Scorer: replay the practice history through the library, grade every answer, report cost.
// Run with: npm run harness -- [--runs N] [--seed S]   (needs ANTHROPIC_API_KEY or GEMINI_API_KEY)

import type { BatchAnswer } from '../src/adapters/batch.js';
import { runBatch } from '../src/adapters/batch.js';
import { createClient, hasAnyKey } from '../src/llm/provider.js';
import type { LlmClient } from '../src/llm/client.js';
import { Memory } from '../src/memory.js';
import { NO_INFO, UNKNOWN } from '../src/recall/answer.js';
import { generate, loadScript, type Question, type Script } from './generate.js';

export type Verdict = { id: string; scenario: string; right: boolean; fail?: 'wrong' | 'stale' | 'false_recall' | 'leak'; text: string };

export type RunScore = {
  right: number;
  total: number;
  stale: number;
  falseRecall: number;
  leak: number;
  dbLeak: boolean;
  cost: number;
  verdicts: Verdict[];
};

export type Summary = { runs: RunScore[]; median: Omit<RunScore, 'verdicts' | 'dbLeak'> & { dbLeak: boolean } };

// Pure: grade one answer against its question.
export function grade(question: Question, answer: BatchAnswer['answer']): Verdict {
  const text = answer.text;
  const lower = text.toLowerCase();
  const forbiddenHit = question.forbidContains.some((needle) => forbiddenIn(lower, needle.toLowerCase()));
  if (forbiddenHit) return { id: question.id, scenario: question.scenario, right: false, fail: question.forbidKind, text };
  if (question.expectAbstain) {
    const abstained = answer.abstained || text === UNKNOWN || text === NO_INFO;
    return { id: question.id, scenario: question.scenario, right: abstained, fail: abstained ? undefined : 'false_recall', text };
  }
  const allPresent = question.expectContains.every((needle) => lower.includes(needle.toLowerCase()));
  return { id: question.id, scenario: question.scenario, right: allPresent, fail: allPresent ? undefined : 'wrong', text };
}

// Pure: leak check over answers given after the forget session, plus the always-forbidden strings.
export function answerLeaks(script: Script, answers: readonly BatchAnswer[]): number {
  let leaks = 0;
  for (const item of answers) {
    const lower = item.answer.text.toLowerCase();
    const forbidden = [...script.forbiddenAlways, ...(item.askAt >= script.forgetSession ? script.forbiddenAfterForget : [])];
    if (forbidden.some((needle) => forbiddenIn(lower, needle.toLowerCase()))) leaks += 1;
  }
  return leaks;
}

export async function scoreOnce(script: Script, llm: LlmClient, seed: number, dbPath: string = ':memory:'): Promise<RunScore> {
  const { history, questions } = generate(script, seed);
  const memory = new Memory({ dbPath, llm });
  memory.reset();
  const batch = await runBatch(memory, history, questions);
  const verdicts = batch.answers.map((item) => grade(questions.find((q) => q.id === item.id) as Question, item.answer));
  const dbLeak = [...script.forbiddenAfterForget, ...script.forbiddenAlways].some((needle) => !memory.audit(needle).clean);
  const score: RunScore = {
    right: verdicts.filter((v) => v.right).length,
    total: verdicts.length,
    stale: verdicts.filter((v) => v.fail === 'stale').length,
    falseRecall: verdicts.filter((v) => v.fail === 'false_recall').length,
    leak: verdicts.filter((v) => v.fail === 'leak').length + answerLeaks(script, batch.answers) + (dbLeak ? 1 : 0),
    dbLeak,
    cost: memory.cost().usd,
    verdicts,
  };
  memory.close();
  return score;
}

export async function scoreRuns(script: Script, llm: LlmClient, runs: number, seed: number): Promise<Summary> {
  const results: RunScore[] = [];
  for (let run = 0; run < runs; run += 1) results.push(await scoreOnce(script, llm, seed));
  const median = (pick: (score: RunScore) => number): number => {
    const sorted = results.map(pick).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] as number;
  };
  return {
    runs: results,
    median: {
      right: median((s) => s.right),
      total: results[0]?.total ?? 0,
      stale: median((s) => s.stale),
      falseRecall: median((s) => s.falseRecall),
      leak: median((s) => s.leak),
      dbLeak: results.some((s) => s.dbLeak),
      cost: median((s) => s.cost),
    },
  };
}

export function formatSummary(summary: Summary): string {
  const lines: string[] = [];
  summary.runs.forEach((run, index) => {
    lines.push(`run ${index + 1}: right ${run.right}/${run.total}  stale ${run.stale}  false recall ${run.falseRecall}  leak ${run.leak}  cost $${run.cost.toFixed(4)}`);
    for (const verdict of run.verdicts) {
      lines.push(`  ${verdict.right ? 'PASS' : `FAIL ${verdict.fail}`.padEnd(17)} ${verdict.id.padEnd(17)} ${verdict.text.slice(0, 90)}`);
    }
  });
  const m = summary.median;
  lines.push(`median: right ${m.right}/${m.total}  stale ${m.stale}  false recall ${m.falseRecall}  leak ${m.leak}${m.dbLeak ? ' (DB LEAK)' : ''}  cost $${m.cost.toFixed(4)}`);
  return lines.join('\n');
}

// A forbidden string must start a word. Short ones ("Pri") must also end the word, so "prior" and
// "price" do not count; longer ones ("peanut", "allerg") may be prefixes, so "peanuts" and "allergic" do.
export function forbiddenIn(text: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const end = needle.length <= 4 ? '(?=[^\\p{L}\\p{N}]|$)' : '';
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}${end}`, 'iu').test(text);
}

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  return value === undefined ? fallback : Number(value);
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
  const summary = await scoreRuns(loadScript(), createClient(), option('--runs', 1), option('--seed', 2026));
  console.log(formatSummary(summary));
}
