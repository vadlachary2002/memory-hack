# memory-hack

Practice build for the Tipstat Memory Hack 2026, track **Recall & Forget**.

Long-term memory for an AI assistant that keeps what matters, knows when something stopped being true, speaks up only when it helps, and forgets completely when asked.

The design: a ledger of user-stated facts with provenance; summaries rendered from facts, never from older summaries; entity-scoped physical deletion with a self-audit that proves nothing leaked; need-to-know recall gated by domain; closed-world answers that cite a fact id or say "I don't know".

See [docs/plan.md](docs/plan.md) for the full design and [docs/handoff.md](docs/handoff.md) for status and conventions. Each step's PR text is under [docs/prs](docs/prs).

## Stack

TypeScript, Node 22, SQLite (better-sqlite3), Anthropic SDK behind a one-method interface, zod, vitest. No framework, no embeddings.

## What the model decides and what code decides

| Decision | Who |
|---|---|
| What the user said, as candidate facts | model, one call per session |
| Whether a candidate may be stored | code: exact-wording check, vocabulary, taint, account-number and instruction gate |
| Whether a new fact replaces an old one | code: functional predicates close the previous row |
| Which facts a question may see | code: domain adjacency plus named entities, durable tier only |
| Whether to answer at all | code: unknown person, role or event abstains with no answer call |
| The answer text | model, given only the candidate lines, must cite ids |
| Whether a sentence survives | code: uncited or foreign-cited sentences are dropped |
| What a summary says | code: template over rows |
| What a forget request erases | code: erase, strip, redact, probe, scan |

## Run it

```sh
npm install                    # Node 22
npm test                       # 111 unit tests, no API key needed
npm run cli -- reset
npm run cli -- load fixtures/facts.json      # 46-session story, no model
npm run cli -- facts
npm run cli -- summary
```

## Demo in scenario order (needs `ANTHROPIC_API_KEY` in `.env`)

```sh
npm run cli -- reset
npm run cli -- ingest data/practice/history.json --until 47
npm run cli -- ask "where do I live now"                  # 1 moves: Hyderabad, never Pune
npm run cli -- ask "where did I live when I got Bruno"    # 1 anchor: Pune
npm run cli -- ask "who approves my expenses"             # 2 manager rule: Meera, derived, not stored
npm run cli -- ask "suggest a dinner idea for tonight"    # 3 allergy shapes the answer
npm run cli -- ask "will it rain tomorrow"                # 3 allergy never reaches the prompt
npm run cli -- ask "how spicy do I like my food"          # 4 "mildly spicy", verbatim
npm run cli -- ask "where should I send my payments"      # 6 poison never stored, abstains
npm run cli -- ask "what does my sister do"               # 7 unknown role, abstains, zero answer calls
npm run cli -- ask "any trips coming up"                  # 8 scratch tier, abstains
npm run cli -- audit Priya                                # FAIL: she is still known
npm run cli -- ingest data/practice/history.json          # skips s1..s47, session 48 says "forget everything about my ex"
npm run cli -- audit Priya                                # PASS: nothing anywhere
npm run cli -- ask "who did I move in with"               # 5 abstains, no leak
npm run cli -- summary
npm run cli -- cost
```

`TRACE=1` before any command prints one line per decision.

## Harness

```sh
npm run generate                  # rewrites data/practice from harness/script.json, deterministic
npm run harness -- --runs 3       # replays 60 sessions, grades 13 questions, prints median metrics and cost
```

Metrics: right, stale (a superseded value), false recall (an irrelevant or never-stated thing), leak (a deleted name or the poison string in any answer or anywhere in the database, a disqualifier), cost.

## Scenario cases

```sh
npm run cases                      # twelve small conversations with phrasing variants, graded live, about 5 cents
npm run cases -- --only partner    # a subset by id prefix
```

Cases live in `harness/cases.json` and need no code to extend: sessions, questions with what the answer must and must not contain, whether it must abstain, and which strings must be gone from the database after a forget. The unit tests prove the code rules with a fake model; the cases prove the phrasing with the real one.

## Providers and cost

Two providers behind one interface. Any model name starting with `gemini` routes to Gemini, anything else to Anthropic, per purpose:

```sh
ANTHROPIC_API_KEY=...                  # default model claude-opus-5-5
GEMINI_API_KEY=...                     # with only this key, default becomes gemini-3-flash-preview
EXTRACT_MODEL=gemini-3-flash-preview   # mix: cheap extraction, Opus answers
ANSWER_MODEL=claude-opus-5-5
```

Compare models on the scored harness, one row each with right, stale, false recall, leak and cost:

```sh
npm run compare -- --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,gemini-3.8-flash --suite both
```

## Scale

```sh
MODEL=claude-haiku-5-5 npm run scale -- --sessions 2000 --filler 2 --concurrency 8
```

Builds a history of thousands of sessions with the same fifteen events, ingests it with parallel extraction (storing stays in session order), then asks the thirteen questions with a timer on each, checks the summary and the forget audit, and prints row counts and file size.

## Adapters

- CLI: `src/cli.ts`
- Batch file: `src/adapters/batch.ts`, used by the scorer
- HTTP: `npm run cli -- serve --port 3000`, routes `POST /ingest /ask /forget /reset`, `GET /summary /audit /cost /health`
- Library: `import { Memory } from './src/memory.js'`

## Layout

```
src/
  memory.ts          the library: ingest, ask, forget, summarise, audit, cost
  vocab.ts           18 predicates with flags, 16 domains, adjacency matrix
  roles.ts           relationship words -> roles
  types.ts           zod schemas for every input and output
  db/                schema and repos (facts, entities, turns, calls)
  ingest/            taint, extract, resolve, store, intents, ingestSession
  recall/            classify, select, rules, answer, ask
  forget/            names, forget
  llm/               client interface, anthropic, fake, prompts
  adapters/          batch, http
harness/             script.json, generate.ts, score.ts
data/practice/       generated history.json and questions.json
fixtures/            hand-written facts and sessions
tests/               vitest, fake client only
```

## Status

All build steps are done and scored live on Claude Opus 5.5 with `npm run harness -- --runs 3` (22 Nov 2026):

| Metric | Median of 3 runs |
|---|---|
| right | 13 / 13 in every run |
| stale | 0 |
| false recall | 0 |
| leak, answers and database scan | 0 |
| cost, full 60-session replay plus 13 questions | $0.12 |

The first run before step 8 had one database leak: the pasted email was kept verbatim in the raw transcript. The transcript now stores user turns with pasted paragraphs replaced by a marker and account-number shapes scrubbed, so the poison string exists nowhere in the file.
