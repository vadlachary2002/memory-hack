# memory-hack

Practice build for the Tipstat Memory Hack 2026, track **Recall & Forget**.

Long-term memory for an AI assistant that keeps what matters, knows when something stopped being true, speaks up only when it helps, and forgets completely when asked.

The design: a ledger of user-stated facts with provenance; summaries rendered from facts, never from older summaries; entity-scoped physical deletion with a self-audit that proves nothing leaked; need-to-know recall gated by domain; closed-world answers that cite a fact id or say "I don't know".

See [docs/plan.md](docs/plan.md) for the full design, schema, scenario-to-mechanism table, harness and build order.

## Stack

TypeScript, Node 20, SQLite (better-sqlite3), Anthropic SDK, vitest. CLI with a trace panel.

## Status

Scaffold only. Build order and verification are in the plan.
