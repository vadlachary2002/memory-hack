// Scale test: thousands of sessions, timed ingest with parallel extraction, timed questions,
// graded answers, summary check, row counts and file size.
// Run with: npm run scale -- --sessions 2000 --filler 2 --concurrency 8   (MODEL=claude-haiku-5-5 recommended)

import { statSync, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createClient, hasAnyKey } from '../src/llm/provider.js';
import { Memory } from '../src/memory.js';
import { generate, loadScript, type Question } from './generate.js';
import { grade } from './score.js';

const DB_PATH = 'data/scale.db';

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  return value === undefined ? fallback : Number(value);
}

function ms(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Environment variables may already be set.
  }
  if (!hasAnyKey()) {
    console.error('set ANTHROPIC_API_KEY or GEMINI_API_KEY');
    process.exit(1);
  }
  const sessions = option('--sessions', 1000);
  const filler = option('--filler', 2);
  const concurrency = option('--concurrency', 8);
  const script = loadScript();
  const { history, questions } = generate(script, 2026, { sessions, fillerPerSession: filler });
  const turns = history.reduce((n, s) => n + s.turns.length, 0);
  console.log(`history: ${history.length} sessions, ${turns} turns, model ${process.env.MODEL ?? 'default'}, concurrency ${concurrency}`);

  for (const suffix of ['', '-journal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
  const memory = new Memory({ dbPath: DB_PATH, llm: createClient() });

  const ingestStart = performance.now();
  const reports = await memory.ingestMany(history, { concurrency });
  const ingestSeconds = (performance.now() - ingestStart) / 1000;
  const stored = reports.reduce((n, r) => n + r.stored.length, 0);
  const forgotten = reports.reduce((n, r) => n + r.forgotten.length, 0);
  console.log(`ingest: ${ingestSeconds.toFixed(1)}s total, ${(history.length / ingestSeconds).toFixed(1)} sessions/s, ${stored} facts stored, ${forgotten} forget requests, cost $${memory.cost().usd.toFixed(4)}`);

  // Questions are asked after everything, which is the hard case: thousands of sessions between the fact
  // and the question. A question scripted for an earlier cutoff is asked as of that session.
  let right = 0;
  for (const question of questions as Question[]) {
    const start = performance.now();
    const asOf = question.askAt < script.sessions ? { asOf: question.askAt } : {};
    const answer = await memory.ask(question.question, asOf);
    const verdict = grade(question, answer);
    right += verdict.right ? 1 : 0;
    console.log(`  ${verdict.right ? 'PASS' : `FAIL ${verdict.fail}`.padEnd(17)} ${ms(start).padStart(6)} ${question.id.padEnd(17)} ${answer.text.slice(0, 80)}`);
  }
  console.log(`questions: ${right}/${questions.length} right`);

  const summaryStart = performance.now();
  const summary = memory.summarise();
  console.log(`summary: ${summary.split('\n').length} lines in ${ms(summaryStart)}; contains Hyderabad ${summary.includes('Hyderabad')}, contains Priya ${summary.includes('Priya')}`);

  const auditStart = performance.now();
  const audit = memory.audit('Priya');
  console.log(`audit Priya: ${audit.clean ? 'PASS' : 'FAIL'} in ${ms(auditStart)}`);

  const db = memory.rawDb();
  const count = (table: string): number => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  console.log(`rows: sessions ${count('sessions')}, turns ${count('turns')}, facts ${count('facts')}, entities ${count('entities')}, llm_calls ${count('llm_calls')}`);
  memory.close();
  console.log(`file: ${(statSync(DB_PATH).size / 1024 / 1024).toFixed(2)} MB at ${DB_PATH}`);
  console.log(`total cost $${reports.reduce((n, r) => n + r.cost, 0).toFixed(4)} ingest`);
}

await main();
