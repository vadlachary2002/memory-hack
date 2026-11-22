// Batch adapter: replay a history, ask questions at their cutoffs, collect answers. Used by the scorer.

import type { Memory } from '../memory.js';
import type { Answer, IngestReport, SessionInput } from '../types.js';

export type BatchQuestion = { id: string; askAt: number; question: string };

export type BatchAnswer = { id: string; askAt: number; question: string; answer: Answer };

export type BatchResult = { ingests: IngestReport[]; answers: BatchAnswer[] };

// Sessions are ingested in index order; a question is asked right after the session it names.
export async function runBatch(memory: Memory, history: readonly SessionInput[], questions: readonly BatchQuestion[]): Promise<BatchResult> {
  const sessions = [...history].sort((a, b) => a.index - b.index);
  const pending = [...questions].sort((a, b) => a.askAt - b.askAt);
  const result: BatchResult = { ingests: [], answers: [] };
  for (const session of sessions) {
    result.ingests.push(await memory.ingest(session));
    while (pending.length > 0 && (pending[0] as BatchQuestion).askAt <= session.index) {
      const item = pending.shift() as BatchQuestion;
      result.answers.push({ ...item, answer: await memory.ask(item.question) });
    }
  }
  for (const item of pending) result.answers.push({ ...item, answer: await memory.ask(item.question) });
  return result;
}
