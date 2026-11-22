# memory-hack

Practice build for the Tipstat Memory Hack 2026, track **Recall & Forget**.

Long-term memory for an AI assistant that keeps what matters, knows when something stopped being true, speaks up only when it helps, and forgets completely when asked.

The design: a ledger of user-stated facts with provenance; summaries rendered from facts, never from older summaries; entity-scoped physical deletion with a self-audit that proves nothing leaked; need-to-know recall gated by domain; closed-world answers that cite a fact id or say "I don't know".

See [docs/plan.md](docs/plan.md) for the full design, schema, scenario-to-mechanism table, harness and build order.

## Stack

TypeScript, Node 22, SQLite (better-sqlite3), Anthropic SDK behind a one-method interface, zod, vitest. CLI with a trace panel.

## Status

Step 1 of 7 done: schema, closed vocabulary with domain adjacency, fact ledger with functional supersession and validity intervals, deterministic renderer, fixture loader, bare CLI. No model calls yet.

```sh
npm install
npm test                                  # 21 unit tests, no API key needed
npm run cli -- reset
npm run cli -- load fixtures/facts.json   # replays a hand-written 46-session story
npm run cli -- facts                      # every row with open/closed state
npm run cli -- summary                    # profile rendered from facts
npm run cli -- summary 5                  # what one session recorded
```

Next: step 2, taint split and extraction with substring validation (first model call). Build order is in the plan.
