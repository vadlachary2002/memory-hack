# memory-hack

Practice build for the Tipstat Memory Hack 2026, track **Recall & Forget**.

Long-term memory for an AI assistant that keeps what matters, knows when something stopped being true, speaks up only when it helps, and forgets completely when asked.

The design: a ledger of user-stated facts with provenance; summaries rendered from facts, never from older summaries; entity-scoped physical deletion with a self-audit that proves nothing leaked; need-to-know recall gated by domain; closed-world answers that cite a fact id or say "I don't know".

See [docs/plan.md](docs/plan.md) for the full design, schema, scenario-to-mechanism table, harness and build order.

## Stack

TypeScript, Node 22, SQLite (better-sqlite3), Anthropic SDK behind a one-method interface, zod, vitest. CLI with a trace panel.

## Status

Steps 1 and 2 of 7 done.

- Step 1: schema, closed vocabulary with domain adjacency, fact ledger with functional supersession and validity intervals, deterministic renderer, fixture loader, bare CLI.
- Step 2: the `Memory` library with `ingest`, a one-method LLM client interface with an Anthropic implementation, taint split of pasted text, one extraction call per session with substring validation in code, entity resolution, and the storage gate (account numbers and instructions refused). The pasted-email fixture stores nothing.

```sh
npm install
npm test                                  # 39 unit tests, no API key needed
npm run cli -- reset
npm run cli -- load fixtures/facts.json   # replays a hand-written 46-session story, no model
npm run cli -- facts                      # every row with open/closed state
npm run cli -- summary                    # profile rendered from facts
npm run cli -- summary 5                  # what one session recorded

cp .env.example .env                      # add ANTHROPIC_API_KEY
npm run cli -- reset
npm run cli -- ingest fixtures/sessions.json   # one extraction call per session
npm run cli -- facts
npm run cli -- cost                       # calls and spend per purpose
```

Next: step 3, forget with erase-vs-strip, redaction, self-audit and the deletion invariant test. Build order is in the plan.
