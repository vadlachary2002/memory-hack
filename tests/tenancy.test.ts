import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dbPathForUser } from '../src/config.js';
import { FakeClient } from '../src/llm/fake.js';
import { Memory } from '../src/memory.js';

let dir: string;

function extraction(object: string, quote: string): Record<string, unknown> {
  return {
    facts: [
      { turnIndex: 1, predicate: 'lives_in', attrKey: null, object, quote, objectIsEntity: false, entityType: null, aliases: [], domains: ['location'], ended: false },
    ],
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-hack-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('dbPathForUser', () => {
  it('maps a user id to a safe file name', () => {
    expect(dbPathForUser('User 42', dir)).toBe(`${dir}/user_42.db`);
    expect(dbPathForUser('../../etc/passwd', dir)).toBe(`${dir}/_etc_passwd.db`);
    expect(() => dbPathForUser('   ', dir)).toThrow();
  });
});

describe('Memory.forUser', () => {
  it('keeps two users in separate files so nothing can cross over', async () => {
    const asha = Memory.forUser('asha', new FakeClient().enqueue('extract', extraction('Pune', 'I moved to Pune')), dir);
    const ravi = Memory.forUser('ravi', new FakeClient().enqueue('extract', extraction('Kochi', 'I moved to Kochi')), dir);

    await asha.ingest({ index: 1, turns: [{ role: 'user', text: 'I moved to Pune' }] });
    await ravi.ingest({ index: 1, turns: [{ role: 'user', text: 'I moved to Kochi' }] });

    expect(asha.facts().map((fact) => fact.objectText)).toEqual(['Pune']);
    expect(ravi.facts().map((fact) => fact.objectText)).toEqual(['Kochi']);
    expect(asha.summarise()).not.toContain('Kochi');
    expect(ravi.summarise()).not.toContain('Pune');
    expect(asha.cost().calls).toBe(1);

    asha.close();
    ravi.close();
  });

  it('reopens the same file for the same user id', async () => {
    const first = Memory.forUser('Asha', new FakeClient().enqueue('extract', extraction('Pune', 'I moved to Pune')), dir);
    await first.ingest({ index: 1, turns: [{ role: 'user', text: 'I moved to Pune' }] });
    first.close();

    const again = Memory.forUser('asha', new FakeClient(), dir);
    expect(again.facts().map((fact) => fact.objectText)).toEqual(['Pune']);
    again.close();
  });
});
