import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/adapters/http.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';
import { UNKNOWN } from '../src/recall/answer.js';

let server: Server;
let base: string;
let client: FakeClient;

async function call(method: string, path: string, payload?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  client = new FakeClient();
  server = await startServer(new Memory({ dbPath: ':memory:', llm: client }), 0);
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
});

afterEach(() => {
  server.close();
});

describe('http adapter', () => {
  it('ingests, answers, forgets, audits and reports cost over JSON', async () => {
    client.enqueue('extract', {
      facts: [{ turnIndex: 1, predicate: 'lives_in', attrKey: null, object: 'Pune', quote: 'I moved to Pune', objectIsEntity: false, entityType: null, aliases: [], domains: ['location'], ended: false }],
    });
    const ingest = await call('POST', '/ingest', { index: 1, turns: [{ role: 'user', text: 'I moved to Pune last month.' }] });
    expect(ingest.status).toBe(200);
    expect(ingest.json.stored).toEqual([1]);

    client.enqueue('classify', { domains: ['location'], names: [], roles: [], timeAnchor: null });
    client.enqueue('answer', { sentences: [{ text: 'Pune.', citedIds: [1] }] });
    const ask = await call('POST', '/ask', { question: 'where do I live' });
    expect(ask.json.text).toBe('Pune.');

    const summary = await call('GET', '/summary');
    expect(String(summary.json.text)).toContain('lives in Pune');

    client.enqueue('classify', { domains: ['general'], names: [], roles: ['sister'], timeAnchor: null });
    const sister = await call('POST', '/ask', { question: 'what does my sister do' });
    expect(sister.json.text).toBe(UNKNOWN);

    const forget = await call('POST', '/forget', { kind: 'domain', domain: 'location' });
    expect(forget.json.erasedFacts).toEqual([1]);
    expect((await call('GET', '/audit?name=Pune')).json.clean).toBe(true);

    const cost = await call('GET', '/cost');
    expect(cost.json.calls).toBe(4);
  });

  it('rejects bad input and unknown routes with JSON errors', async () => {
    expect((await call('POST', '/ask', { question: '' })).status).toBe(500);
    expect((await call('GET', '/nowhere')).status).toBe(404);
    expect((await call('GET', '/audit')).status).toBe(400);
  });
});
