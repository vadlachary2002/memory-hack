import { describe, expect, it } from 'vitest';
import { formatResults, hasFailures, loadCases, runCase } from '../harness/cases.js';
import { FakeClient } from '../src/llm/fake.js';

describe('scenario cases file', () => {
  it('is valid and every question id is unique within its case', () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const item of cases) {
      const ids = item.questions.map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const question of item.questions) {
        expect(item.sessions.some((session) => session.index === question.askAt)).toBe(true);
      }
    }
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it('runs a case end to end with the fake client and reports leaks from the database audit', async () => {
    const item = loadCases().find((candidate) => candidate.id === 'forget-same-session');
    if (item === undefined) throw new Error('case missing');
    const client = new FakeClient()
      .enqueue('extract', {
        facts: [{ turnIndex: 1, predicate: 'partner_of', attrKey: null, object: 'Neha', quote: 'Neha is my girlfriend', objectIsEntity: true, entityType: 'person', aliases: [], domains: ['relationships'], ended: false }],
      })
      .enqueue('classify', { domains: ['relationships'], names: [], roles: ['girlfriend'], timeAnchor: null });
    const result = await runCase(item, client);
    expect(result.verdicts.map((v) => v.right)).toEqual([true]);
    expect(result.dbLeaks).toEqual([]);
    expect(hasFailures([result])).toBe(false);
    expect(formatResults([result])).toContain('PASS forget-same-session');
  });
});
