// Every model call with its cost, so the harness can print exact spend per purpose.

import type { Db } from './connection.js';
import { priceFor, type Purpose } from '../config.js';
import type { Usage } from '../llm/client.js';

export type PurposeCost = { calls: number; inputTokens: number; outputTokens: number; usd: number };

export type CostReport = { calls: number; usd: number; byPurpose: Record<Purpose, PurposeCost> };

const PURPOSES: Purpose[] = ['extract', 'screen', 'classify', 'answer'];

export class CallsRepo {
  constructor(private readonly db: Db) {}

  // Records the call and returns its cost in USD.
  record(purpose: Purpose, usage: Usage, sessionIdx?: number): number {
    const usd = costOf(usage);
    this.db
      .prepare(
        `INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, session_idx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        purpose,
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.cacheWriteTokens,
        usd,
        sessionIdx ?? null,
      );
    return usd;
  }

  totals(): CostReport {
    const rows = this.db
      .prepare(
        `SELECT purpose, count(*) AS calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens, sum(cost_usd) AS usd
         FROM llm_calls GROUP BY purpose`,
      )
      .all() as { purpose: Purpose; calls: number; input_tokens: number; output_tokens: number; usd: number }[];
    const byPurpose = Object.fromEntries(
      PURPOSES.map((purpose) => [purpose, { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }]),
    ) as Record<Purpose, PurposeCost>;
    let calls = 0;
    let usd = 0;
    for (const row of rows) {
      byPurpose[row.purpose] = { calls: row.calls, inputTokens: row.input_tokens, outputTokens: row.output_tokens, usd: row.usd };
      calls += row.calls;
      usd += row.usd;
    }
    return { calls, usd, byPurpose };
  }
}

function costOf(usage: Usage): number {
  const price = priceFor(usage.model);
  const perToken = (tokens: number, perMillion: number): number => (tokens * perMillion) / 1_000_000;
  return (
    perToken(usage.inputTokens, price.input) +
    perToken(usage.outputTokens, price.output) +
    perToken(usage.cacheReadTokens, price.cacheRead) +
    perToken(usage.cacheWriteTokens, price.cacheWrite)
  );
}
