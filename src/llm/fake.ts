// Test double: hands back queued values per purpose and records what it was asked.

import type { Purpose } from '../config.js';
import type { LlmClient, StructuredRequest, StructuredResult } from './client.js';

export type SeenRequest = { purpose: Purpose; system: string; user: string };

const FAKE_USAGE = { model: 'fake', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };

export class FakeClient implements LlmClient {
  readonly seen: SeenRequest[] = [];
  private readonly queues = new Map<Purpose, unknown[]>();

  enqueue(purpose: Purpose, value: unknown): this {
    const queue = this.queues.get(purpose) ?? [];
    queue.push(value);
    this.queues.set(purpose, queue);
    return this;
  }

  async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.seen.push({ purpose: request.purpose, system: request.system, user: request.user });
    const queue = this.queues.get(request.purpose) ?? [];
    // No queued screen verdict means "pasted": the safe default, so existing tests keep their taint.
    const next = queue.shift() ?? (request.purpose === 'screen' ? { verdicts: [] } : undefined);
    if (next === undefined) throw new Error(`FakeClient has no queued ${request.purpose} response`);
    return { value: request.schema.parse(next), usage: { ...FAKE_USAGE } };
  }
}
