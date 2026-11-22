import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerLeaks, grade } from '../harness/score.js';
import { generate, loadScript, type Question } from '../harness/generate.js';
import { runBatch } from '../src/adapters/batch.js';
import { detectForget } from '../src/ingest/intents.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { NO_INFO, UNKNOWN } from '../src/recall/answer.js';
import type { Answer } from '../src/types.js';

const SCRIPT = loadScript();

function answer(text: string, abstained = false): Answer {
  return { text, cited: [], abstained, candidates: [], domains: ['general'], cost: 0 };
}

describe('detectForget', () => {
  it('finds the target of a forget request and ignores ordinary statements', () => {
    expect(detectForget('Please forget everything about my ex, completely.')).toEqual([{ kind: 'entity', name: 'my ex' }]);
    expect(detectForget('Delete Priya from your memory')).toEqual([{ kind: 'entity', name: 'Priya' }]);
    expect(detectForget('I forgot my umbrella at the office')).toEqual([]);
    expect(detectForget('Priya and I moved in together')).toEqual([]);
  });
});

describe('generate', () => {
  it('is byte-identical for the same seed and matches the committed practice data', () => {
    const once = generate(SCRIPT, 2026);
    const twice = generate(SCRIPT, 2026);
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
    expect(once.history).toHaveLength(60);
    const committed = JSON.parse(readFileSync(new URL('../data/practice/history.json', import.meta.url), 'utf8'));
    expect(once.history).toEqual(committed);
  });

  it('places every scripted event and about fifty summary turns', () => {
    const { history } = generate(SCRIPT);
    const text = (index: number): string => history[index - 1]?.turns.map((turn) => turn.text).join('\n') ?? '';
    expect(text(2)).toContain('moved to Pune');
    expect(text(40)).toContain('ACC-7781');
    expect(text(48)).toContain('forget everything about my ex');
    const summaries = history.filter((session) => session.turns.some((turn) => turn.text === SCRIPT.summaryTurn)).length;
    expect(summaries).toBe(50);
  });
});

describe('grade', () => {
  const byId = (id: string): Question => SCRIPT.questions.find((q) => q.id === id) as Question;

  it('scores right, stale, false recall and leak', () => {
    expect(grade(byId('moves-now'), answer('You live in Hyderabad.')).right).toBe(true);
    expect(grade(byId('moves-now'), answer('You live in Pune.')).fail).toBe('stale');
    expect(grade(byId('allergy-weather'), answer('Check the forecast, and avoid peanuts.')).fail).toBe('false_recall');
    expect(grade(byId('sister'), answer(UNKNOWN, true)).right).toBe(true);
    expect(grade(byId('sister'), answer('She is a teacher.')).fail).toBe('false_recall');
    expect(grade(byId('forget-direct'), answer('You moved in with Priya.')).fail).toBe('leak');
    expect(grade(byId('forget-direct'), answer(NO_INFO, true)).right).toBe(true);
  });

  it('counts leaks of deleted names only after the forget session', () => {
    const before = { id: 'x', askAt: 30, question: 'q', answer: answer('Priya and you adopted Bruno.') };
    const after = { ...before, askAt: 60 };
    const poison = { ...before, askAt: 10, answer: answer('Send to ACC-7781.') };
    expect(answerLeaks(SCRIPT, [before])).toBe(0);
    expect(answerLeaks(SCRIPT, [after])).toBe(1);
    expect(answerLeaks(SCRIPT, [poison])).toBe(1);
  });
});

describe('runBatch with a forget request inside the history', () => {
  it('asks questions at their cutoffs and carries out the forget from the chat turn', async () => {
    const client = new FakeClient();
    const memory = new Memory({ dbPath: ':memory:', llm: client });
    const history = [
      { index: 1, turns: [{ role: 'user' as const, text: 'Priya and I moved in together.' }] },
      { index: 2, turns: [{ role: 'user' as const, text: 'Please forget everything about Priya, completely.' }] },
    ];
    client.enqueue('extract', {
      facts: [{ turnIndex: 1, predicate: 'partner_of', attrKey: null, object: 'Priya', quote: 'Priya and I moved in together', objectIsEntity: true, entityType: 'person', aliases: [], domains: ['relationships'], ended: false }],
    });
    client.enqueue('classify', { domains: ['relationships'], names: ['Priya'], roles: [], timeAnchor: null });
    client.enqueue('answer', { sentences: [{ text: 'You moved in with Priya.', citedIds: [1] }] });
    client.enqueue('classify', { domains: ['relationships'], names: ['Priya'], roles: [], timeAnchor: null });

    const result = await runBatch(memory, history, [
      { id: 'before', askAt: 1, question: 'Who did I move in with?' },
      { id: 'after', askAt: 2, question: 'Who did I move in with?' },
    ]);

    expect(result.answers[0]?.answer.text).toBe('You moved in with Priya.');
    expect(result.ingests[1]?.forgotten).toHaveLength(1);
    expect(result.ingests[1]?.forgotten[0]?.scanClean).toBe(true);
    expect(result.answers[1]?.answer.text).toBe(UNKNOWN);
    expect(memory.audit('Priya').clean).toBe(true);
  });
});
