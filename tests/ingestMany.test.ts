import { describe, expect, it } from 'vitest';
import { generate, loadScript } from '../harness/generate.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';

function lives(city: string, quote: string): Record<string, unknown> {
  return {
    facts: [{ turnIndex: 1, about: 'me', predicate: 'lives_in', attrKey: null, object: city, quote, objectIsEntity: false, entityType: null, aliases: [], domains: ['location'], ended: false }],
  };
}

describe('ingestMany', () => {
  it('extracts in parallel but stores in session order, so supersession is right', async () => {
    const client = new FakeClient();
    // The fake hands responses out in call order; with concurrency the call order is not the session order.
    client.enqueue('extract', lives('Pune', 'moved to Pune')).enqueue('extract', lives('Bengaluru', 'moved to Bengaluru')).enqueue('extract', lives('Hyderabad', 'moved to Hyderabad'));
    const memory = new Memory({ dbPath: ':memory:', llm: client });
    const sessions = [
      { index: 3, turns: [{ role: 'user' as const, text: 'moved to Hyderabad' }] },
      { index: 1, turns: [{ role: 'user' as const, text: 'moved to Pune' }] },
      { index: 2, turns: [{ role: 'user' as const, text: 'moved to Bengaluru' }] },
    ];
    const reports = await memory.ingestMany(sessions, { concurrency: 3 });
    expect(reports.map((r) => r.session)).toEqual([1, 2, 3]);
    const homes = memory.facts().filter((f) => f.predicate === 'lives_in');
    expect(homes.map((f) => [f.validFrom, f.validTo])).toEqual([
      [1, 2],
      [2, 3],
      [3, null],
    ]);
  });

  it('runs a forget request from a chat turn in order', async () => {
    const client = new FakeClient();
    client.enqueue('extract', {
      facts: [{ turnIndex: 1, about: 'me', predicate: 'partner_of', attrKey: null, object: 'Neha', quote: 'Neha is my girlfriend', objectIsEntity: true, entityType: 'person', aliases: [], domains: ['relationships'], ended: false }],
    });
    const memory = new Memory({ dbPath: ':memory:', llm: client });
    const reports = await memory.ingestMany(
      [
        { index: 1, turns: [{ role: 'user', text: 'Neha is my girlfriend' }] },
        { index: 2, turns: [{ role: 'user', text: 'Please forget everything about Neha.' }] },
      ],
      { concurrency: 2 },
    );
    expect(reports[1]?.forgotten).toHaveLength(1);
    expect(memory.audit('Neha').clean).toBe(true);
  });
});

describe('generate at scale', () => {
  it('keeps the scripted events at their sessions and adds filler after', () => {
    const { history } = generate(loadScript(), 2026, { sessions: 500, fillerPerSession: 3 });
    expect(history).toHaveLength(500);
    expect(history[47]?.turns.some((t) => t.text.includes('forget everything about my ex'))).toBe(true);
    expect(history[499]?.turns.filter((t) => t.role === 'user')).toHaveLength(4);
    const turns = history.reduce((n, s) => n + s.turns.length, 0);
    expect(turns).toBeGreaterThan(3500);
  });
});
