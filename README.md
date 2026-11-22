# memory-hack

Practice build for the Tipstat Memory Hack 2026, track **Recall & Forget**.

Long-term memory for an AI assistant that keeps what matters, knows when something stopped being true, speaks up only when it helps, and forgets completely when asked.

The design: a ledger of user-stated facts with provenance; summaries rendered from facts, never from older summaries; entity-scoped physical deletion with a self-audit that proves nothing leaked; need-to-know recall gated by domain; closed-world answers that cite a fact id or say "I don't know".

See [docs/plan.md](docs/plan.md) for the full design, schema, scenario-to-mechanism table, harness and build order.

## Stack

TypeScript, Node 22, SQLite (better-sqlite3), Anthropic SDK behind a one-method interface, zod, vitest. CLI with a trace panel.

## Status

Steps 1 to 3 of 7 done.

- Step 1: schema, closed vocabulary with domain adjacency, fact ledger with functional supersession and validity intervals, deterministic renderer, fixture loader, bare CLI.
- Step 2: the `Memory` library with `ingest`, a one-method LLM client interface with an Anthropic implementation, taint split of pasted text, one extraction call per session with substring validation in code, entity resolution, and the storage gate (account numbers and instructions refused). The pasted-email fixture stores nothing.
- Step 3: `forget` by name, alias, relationship word ("my ex", "my old manager"), predicate, or domain. Physical erase of the person's facts, strip of passing mentions, redaction of raw turns, role-based resolution through closed relationships, four self-probes and a database-wide scan. The report carries ids only. `audit` scans for any name on demand.
- Step 4: `ask` with one classify call, a closed-world check in code (unknown person or role answers "I don't know" with no answer call), need-to-know selection by domain adjacency plus named entities, and a cited answer whose uncited sentences are dropped.
- Step 5: time anchors ("when I got Bruno" answers as of the adoption session) and the manager-to-approver derivation rule, applied at answer time and never stored.

```sh
npm install
npm test                                  # 65 unit tests, no API key needed
npm run cli -- reset
npm run cli -- load fixtures/facts.json   # replays a hand-written 46-session story, no model
npm run cli -- facts                      # every row with open/closed state
npm run cli -- summary                    # profile rendered from facts
npm run cli -- summary 5                  # what one session recorded
npm run cli -- audit Priya                # FAIL: the name is still in facts, turns, entities, summary
npm run cli -- forget "my ex"             # resolves to Priya through the closed partner_of fact
npm run cli -- audit Priya                # PASS: nothing left anywhere
npm run cli -- facts                      # f7 erased, Bruno's quote reads "[redacted] and I adopted Bruno"

cp .env.example .env                      # add ANTHROPIC_API_KEY
npm run cli -- reset
npm run cli -- ingest fixtures/sessions.json   # one extraction call per session
npm run cli -- facts
npm run cli -- cost                       # calls and spend per purpose
```

```sh
npm run cli -- ask "will it rain tomorrow"       # allergy never reaches the prompt
npm run cli -- ask "what does my sister do"      # abstains, one classify call only
npm run cli -- ask "dinner idea for tonight"     # peanuts and mildly spicy are candidates
```

Next: step 6, the 60-session harness and scorer. Build order is in the plan.
