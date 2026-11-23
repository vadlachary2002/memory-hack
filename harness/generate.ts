// Seeded generator: the life script plus filler rendered into a byte-identical 60-session history.
// No model, no real data. Run with: npm run generate

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { SessionInput } from '../src/types.js';

const DEFAULT_SEED = 2026;
const OUT_DIR = 'data/practice';

export const QuestionSchema = z.object({
  id: z.string(),
  askAt: z.number().int().positive(),
  // Scenario label for reports; scenario cases leave it to their case id.
  scenario: z.string().default(''),
  question: z.string(),
  expectContains: z.array(z.string()),
  forbidContains: z.array(z.string()),
  forbidKind: z.enum(['stale', 'false_recall', 'leak']),
  expectAbstain: z.boolean(),
});

export type Question = z.infer<typeof QuestionSchema>;

export const ScriptSchema = z.object({
  sessions: z.number().int().positive(),
  forgetSession: z.number().int().positive(),
  events: z.array(z.object({ session: z.number().int().positive(), scenario: z.string(), user: z.string() })),
  filler: z.array(z.string()).min(1),
  assistant: z.array(z.string()).min(1),
  summaryTurn: z.string(),
  summaryReply: z.string(),
  questions: z.array(QuestionSchema),
  forbiddenAfterForget: z.array(z.string()),
  forbiddenAlways: z.array(z.string()),
});

export type Script = z.infer<typeof ScriptSchema>;

export type Generated = { history: SessionInput[]; questions: Question[] };

export function loadScript(): Script {
  return ScriptSchema.parse(JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8')));
}

// Every session: its scripted events, one filler line, and in five of six sessions a "summarise" turn.
export function generate(script: Script, seed: number = DEFAULT_SEED): Generated {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const history: SessionInput[] = [];
  for (let index = 1; index <= script.sessions; index += 1) {
    const turns: SessionInput['turns'] = [];
    for (const event of script.events.filter((item) => item.session === index)) {
      turns.push({ role: 'user', text: event.user }, { role: 'assistant', text: pick(script.assistant) });
    }
    turns.push({ role: 'user', text: pick(script.filler) }, { role: 'assistant', text: pick(script.assistant) });
    if (index % 6 !== 0) turns.push({ role: 'user', text: script.summaryTurn }, { role: 'assistant', text: script.summaryReply });
    history.push({ index, turns });
  }
  return { history, questions: script.questions };
}

export function writeGenerated(generated: Generated, dir: string = OUT_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/history.json`, `${JSON.stringify(generated.history, null, 2)}\n`);
  writeFileSync(`${dir}/questions.json`, `${JSON.stringify(generated.questions, null, 2)}\n`);
}

// Small seeded PRNG; same seed, same sequence, on every machine.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const seed = Number(process.argv[2] ?? DEFAULT_SEED);
  writeGenerated(generate(loadScript(), seed));
  console.log(`wrote ${OUT_DIR}/history.json and questions.json (seed ${seed})`);
}
