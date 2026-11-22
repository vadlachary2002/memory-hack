# Memory Hack practice project — implementation plan (rev 2, 22 Nov)

## 1. Context

Nagaraju is selected for the Tipstat Memory Hack (ticket MH26-A9D3D2), a one-day solo hackathon on long-term memory for AI assistants, on **Saturday 28 November 2026** at WeWork Salarpuria Symbiosis, Bengaluru. Track: **03 Recall & Forget**. Every submission runs on a hidden 60-session user history under a token budget and is checked on 8 published scenarios (moves, new manager, allergy, spicy drift, forget-my-ex, poisoned paste, unknown sister, one-off noise). Hard rule: leaking a deleted fact or storing a poisoned instruction bars the top three.

This practice project exists for three reasons:

1. Prove the Recall & Forget design passes all 8 scenarios on a synthetic history, with a reproducible score and cost.
2. Rehearse the build so it can be rewritten from scratch in about 6 hours on the day (event rules forbid reusing pre-written code).
3. Be a public repo on github.com/vadlachary2002 showing real LLM work.

Decisions: TypeScript + Node 22, SQLite via better-sqlite3, Anthropic SDK behind a one-method interface, zod for schemas, vitest for tests, CLI with a trace panel. Repo: github.com/vadlachary2002/memory-hack. The API key lives in `.env` (git-ignored) locally and as a cloud environment secret for remote sessions.

## 2. The design in one paragraph

Memory is a ledger of **user-stated facts** with provenance. A fact is `subject, predicate, object, verbatim quote, source turn, valid_from, valid_to, domains`. The predicate comes from a **closed vocabulary** that carries the rules (functional, durable, relational, ephemeral), so supersession, durability, and what can be stored at all are decided by code, not by the model. Summaries and the profile are **template renders of facts**, never LLM text, so nothing can drift. Deletion is entity-scoped and **physical**: object and quote are nulled, mentions in surviving quotes and turns are redacted, then the system probes itself and prints an id-only audit report. Recall is **need-to-know**: facts carry domain tags from write time, questions are classified into domains, and candidates come from a domain adjacency matrix unioned with entity mentions. Answers are **closed-world**: an unknown entity or role returns "I don't know" with no model call, and every sentence must cite a fact id or it is dropped. No embeddings.

## 3. What the model does and what code does

| Decision | Who decides | How |
|---|---|---|
| What the user said, as candidate facts | Model (extract call) | One structured call per session over clean user turns |
| Whether a candidate may be stored | Code | Substring validation, vocabulary gate, taint, account-number refusal, "about the user" check |
| Whether a new fact replaces an old one | Code | Functional flag on the predicate closes the open row |
| Whether a fact is recalled for a question | Code | Domain adjacency plus entity mention, tier filter |
| Which domains a question is about | Model (classify call) | Structured call returning closed enums |
| Whether to answer at all | Code | Closed-world check on entities and roles, zero model calls on abstain |
| The answer text | Model (answer call) | Given only the candidate list, must cite fact ids |
| Whether an answer sentence survives | Code | Uncited sentences dropped, empty answer becomes "I don't have that" |
| What a summary says | Code | Template render of facts |
| What is deleted | Code | Entity-scoped erase, strip, redact, audit |

Three model calls exist: `extract`, `classify`, `answer`. Nothing else talks to the model.

## 4. Public API (the library)

The core is a library. Everything the harness or a judge needs goes through these four functions. The CLI, the HTTP adapter and the scorer are thin wrappers that only call these.

```ts
// src/memory.ts
export class Memory {
  constructor(opts: { dbPath: string; llm: LlmClient; trace?: Trace });

  // Store one session. Turns are the raw chat messages of that session.
  ingest(session: SessionInput): Promise<IngestReport>;

  // Answer a question as of a session index (default: latest).
  ask(question: string, opts?: { asOf?: number }): Promise<Answer>;

  // Forget a person, a predicate, or a whole domain. Returns the audit.
  forget(target: ForgetTarget): Promise<ForgetReport>;

  // Deterministic profile or session summary rendered from facts.
  summarise(opts?: { session?: number }): string;

  // Utilities for adapters and tests.
  reset(): void;
  cost(): CostReport;
}
```

Input and output shapes (zod schemas in `src/types.ts`):

```ts
type SessionInput = {
  index: number;                 // 1-based session number, the time axis
  date?: string;                 // ISO date if the harness gives one
  turns: { role: 'user' | 'assistant'; text: string }[];
};

type IngestReport = {
  session: number;
  stored: number[];              // fact ids inserted
  superseded: number[];          // fact ids whose valid_to was closed
  rejected: { reason: RejectReason; candidate: string }[];
  tainted: number;               // third-party spans skipped
  cost: number;                  // USD for this session's extract call
};

type Answer = {
  text: string;                  // final text after citation stripping
  cited: number[];               // fact ids that survived
  abstained: boolean;            // true when no model call was made
  candidates: number[];          // fact ids offered to the model
  domains: string[];             // classifier output
  cost: number;
};

type ForgetTarget =
  | { kind: 'entity'; name: string }      // "Priya", "my ex"
  | { kind: 'predicate'; predicate: string }
  | { kind: 'domain'; domain: string };

type ForgetReport = {
  entityIds: number[];
  erasedFacts: number[];
  strippedFacts: number[];
  redactedTurns: number[];
  probes: { name: string; passed: boolean }[];
  scanClean: boolean;            // DB-wide text scan found nothing
};
```

Rule: no names in `ForgetReport`, ids only. Rule: `summarise` never calls the model.

Tenancy: one database file per user. `Memory.forUser(userId, llm)` maps a sanitised user id to `data/users/<id>.db`. Isolation is a file boundary, so no query needs a user filter and cross-user leakage is impossible by construction. If the harness passes a user id, the adapter calls `forUser`; if it does not, the single default file is used.

## 5. Adapters (how the outside world reaches the library)

The scoring harness interface is unknown until 10:00 on the day. Every plausible shape is one small file over the same `Memory` class.

| Shape | File | What it does |
|---|---|---|
| CLI | `src/cli.ts` | `reset`, `ingest <history.json> [--until N]`, `ask "<q>" [--at N]`, `forget "<name>"`, `audit "<name>"`, `summary [N]`, `harness` |
| HTTP | `src/adapters/http.ts` | `POST /ingest`, `POST /ask`, `POST /forget`, `GET /summary`, JSON in and out, same shapes as section 4 |
| Batch file | `src/adapters/batch.ts` | Read `history.json` and `questions.json`, write `answers.json`. The practice scorer uses this |
| Library import | none needed | A Python or TS harness can import `Memory` directly or shell out to the CLI |

On the day: read their starter repo, pick the matching adapter, write it in the first 20 minutes, run their sample, then build the core.

## 6. Folder structure

```
memory-hack/
  package.json            type: module; scripts: test, cli, harness, typecheck
  tsconfig.json           NodeNext, strict, noUncheckedIndexedAccess
  .env.example            ANTHROPIC_API_KEY, MODEL, EXTRACT_MODEL, CLASSIFY_MODEL, ANSWER_MODEL
  README.md               design summary, demo script, cost table
  docs/plan.md            this file
  src/
    memory.ts             the Memory class: the only public surface
    types.ts              zod schemas for every input and output shape
    config.ts             model ids, prices per million tokens, thresholds (taint length 400, max candidates 12)
    vocab.ts              predicate table with flags and phrasing; domain enum; adjacency matrix
    trace.ts              prefixed console lines for every decision; off by default
    db/
      schema.sql          tables in section 7
      connection.ts       open, migrate, reset, transaction helper
      facts.repo.ts       insert with supersession, close, currentFor, validAt, byDomains, byEntity, eraseByEntity, stripMentions, scanText
      entities.repo.ts    upsert, resolve by name or alias or role, erase
      turns.repo.ts       addSession, addTurn, redactByEntity, scanText
      calls.repo.ts       record LLM usage and cost, totals by purpose
    llm/
      client.ts           interface LlmClient { structured(purpose, schema, system, user) }
      anthropic.ts        the one implementation; messages.parse with zod output; records usage
      prompts.ts          the three system prompts as constants
    ingest/
      taint.ts            pure: split user text into clean and third-party spans
      extract.ts          one structured call per session; substring validation; drops violations
      resolve.ts          entity canonicalisation, alias and role attachment
      store.ts            gate (vocabulary, taint, account number, about-the-user), tier routing, ended statements, insert
      ingestSession.ts    taint -> extract -> resolve -> store, with trace
    recall/
      classify.ts         model: question -> domains, names, roles, timeAnchor (closed enums)
      select.ts           adjacency + entity match + tier filter -> capped candidate list
      answer.ts           closed-world check, cited generation, uncited-sentence stripping, empty fallback
    forget/
      forget.ts           resolve -> erase or strip -> redact -> probes -> DB-wide scan -> id-only report
    render.ts             profile and session summary templates from facts
    cli.ts                command adapter
    adapters/
      http.ts             HTTP adapter
      batch.ts            file adapter used by the scorer
  harness/
    script.json           hand-written life script: ordered events with session index for all 8 scenarios
    generate.ts           seeded PRNG renders script + filler into data/practice/history.json and questions.json
    score.ts              replay via batch adapter, metrics, cost; N runs with per-metric median
  data/practice/          generated history.json and questions.json, committed
  tests/                  vitest for every pure module; no API calls
```

Style: public methods first, helpers below, constants at top, one-line comments, `import type`, no `any`.

## 7. SQLite schema

- `sessions(id, idx, started_at)`
- `turns(id, session_id, idx, role, text, redacted_at)` — text nulled on redaction
- `entities(id, canonical_name, type, aliases_json, roles_json, first_session_id, erased_at)` — name and aliases nulled on erase
- `facts(id, subject_entity_id, predicate, attr_key, object_text, object_entity_id, quote, source_turn_id, session_id, valid_from, valid_to, recorded_at, domains_json, tier, erased_at)` — object_text, object_entity_id, quote nulled on erase; id, predicate, erased_at remain for lineage. `attr_key` is only used by the open `attribute` predicate
- `deletions(id, target_json, request_turn_id, requested_at, report_json)` — ids only
- `llm_calls(id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, session_id, created_at)`
- `facts_fts` — optional FTS5 over object_text and quote, first on the cut list

Time axis: `valid_from` and `valid_to` are session indices. If the harness gives dates they are stored on `sessions.started_at` for display, but all comparisons use indices. No `derived` table: summaries render on demand.

**Deletion invariant**, one function, unit-tested: after `forget(entity)`, no non-erased row in any text column of `facts`, `turns`, `entities` (or `facts_fts`) contains the entity's name or any alias, and a DB-wide scan confirms it.

## 8. The vocabulary

| Predicate | functional | durable | relational | ephemeral | default domains |
|---|---|---|---|---|---|
| lives_in | yes | yes | no | no | location |
| works_at | yes | yes | no | no | work |
| reports_to | yes | yes | yes | no | work |
| expense_approver | yes | yes | yes | no | work, finance |
| allergic_to | no | yes | no | no | health |
| dietary | no | yes | no | no | health, food |
| partner_of | yes | yes | yes | no | relationships |
| sibling_of | no | yes | yes | no | family |
| parent_of / child_of | no | yes | yes | no | family |
| friend_of | no | yes | yes | no | relationships |
| adopted_pet | no | yes | no | no | pets, home |
| prefers | no | yes | no | no | set by extraction |
| dislikes | no | yes | no | no | set by extraction |
| attribute (key) | yes per key | yes | no | no | set by extraction |
| searched_for | no | no | no | yes | scratch |
| considered | no | no | no | yes | scratch |
| started_project | no | no | no | yes | scratch |

Domains: location, work, finance, health, food, dining, travel, gifts, relationships, family, pets, home, weather, preferences, tech, general.

Adjacency (a question in the left domain may see facts in the right domains, plus itself):

- health -> food, dining, travel, gifts
- food <-> dining; both -> health, preferences
- travel -> location, health, pets, family
- weather -> location
- location -> travel, weather
- work -> finance; finance -> work
- relationships -> family, gifts, home; family -> relationships
- pets -> home, travel; home -> pets, location
- gifts -> preferences, relationships, family
- preferences -> food, dining, gifts, tech
- general -> nothing extra (entity match only)

## 9. Data flow for each operation

**ingest(session)**

1. Store the session row and every turn.
2. Taint: for each user turn, split into clean spans and third-party spans (after code fences, after URLs, quoted blocks, spans over 400 chars, "forwarded"/"pasted" markers). Third-party spans are never extracted.
3. Extract: one structured call with all clean user spans of the session. Output: list of `{ predicate, attrKey?, object, quote, turnIndex, objectIsPerson, ended }`.
4. Validate each candidate in code: `object ⊆ quote ⊆ turn text`, predicate in vocabulary, no account-number pattern, candidate is a statement about the user. Violations go to `rejected` with a reason.
5. Resolve: for relational predicates, upsert the object entity by name, attach aliases and the role implied by the predicate (partner_of gives role "partner").
6. Store: route ephemeral predicates to tier scratch. If `ended` is true, close the matching open fact instead of inserting. Otherwise insert; functional predicates close the open row for the same subject and predicate (and attr_key) in the same transaction. Same value as the open row: no-op, return the existing id.
7. Record the extract call's tokens and cost. Return `IngestReport`.

**ask(question, asOf)**

1. Classify: one structured call. Output: `{ domains[], names[], roles[], timeAnchor? }` using closed enums.
2. Closed-world check in code: every name must resolve to a non-erased entity; every role must have a matching relational fact for the user. If either fails, return `{ abstained: true, text: "I don't know" }` with no further calls.
3. Time anchor: if present, resolve it to a session index via the anchor fact's valid_from, and use that as `asOf`.
4. Select: facts valid at `asOf`, tier durable, whose domains intersect the adjacency expansion of the question's domains, unioned with facts mentioning the resolved entities. Capped at 12, newest first. Rule facts (manager approves expenses) are appended when a work or finance question has no explicit answer fact.
5. Answer: one structured call with the candidate list as `[fN] subject predicate object (quote)` lines. Output: list of sentences each with `citedIds[]`.
6. Strip: drop any sentence whose citedIds is empty or names an id not in the candidate list. If nothing survives, text becomes "I don't have that".
7. Record calls. Return `Answer`.

**forget(target)**

1. Resolve the target: by canonical name, alias, or role (role resolves through relational facts, including closed ones, so "my ex" finds the closed partner_of). A predicate or domain target selects facts directly.
2. Erase: facts with subject = entity, and relational facts with object = entity. Null object, quote, object_entity; set erased_at.
3. Strip: facts where the entity is only mentioned in the quote. Replace the mention with `[redacted]`, keep the object.
4. Redact: turns whose text contains the name or aliases get text nulled.
5. Erase the entity's name and aliases.
6. Rebuild FTS if present.
7. Probes: direct ask, indirect ask by role, summary render. Each must not contain the name or aliases.
8. DB-wide scan of every text column for the name and aliases.
9. Write the deletions row. Return `ForgetReport` with ids only.

**summarise(session?)**

1. Read open durable facts (or facts recorded in that session).
2. Render through per-predicate templates: "Lives in Hyderabad (since session 44) [f30]".
3. Return the string. No model call, no storage.

## 10. Scenario -> mechanism

| # | Scenario | Mechanism |
|---|---|---|
| 1 | Moved three times | `lives_in` functional supersession in code; temporal question resolves the anchor fact's valid_from, then `validAt` |
| 2 | New manager -> expense approver | explicit `expense_approver` wins; else current `reports_to` plus the rule line at answer time; nothing derived is stored |
| 3 | Allergy -> recipe, not weather | `allergic_to` tagged health; adjacency keeps weather to location only |
| 4 | Mildly spicy survives summaries | substring validation at extraction; summaries are renders |
| 5 | Forget my ex | role resolution through closed `partner_of`; erase vs strip; redaction; probes; DB-wide scan; id-only report |
| 6 | Poisoned paste | taint split; no instruction predicate; about-the-user gate; account-number refusal |
| 7 | Sister never mentioned | closed-world check on roles; zero answer calls; citation stripping for the known-entity variant |
| 8 | Flight search, abandoned project | ephemeral predicates in scratch tier excluded from recall; `ended` closes valid_to; recurrence never promotes |

## 11. LLM usage

- Three call types: `extract` (one per session), `classify` (one per question), `answer` (one per question). Abstentions and summaries make zero calls.
- Default model `claude-opus-5-5` for all three, effort `low` for extract and classify, `medium` for answer. Per-purpose env overrides (`EXTRACT_MODEL`, `CLASSIFY_MODEL`, `ANSWER_MODEL`) so extraction can move to `claude-haiku-5-5` after seeing the measured cost. That is the user's call, not a default.
- Structured outputs via `client.messages.parse` with a zod output format, enums for predicate, domain, and role. No forced `tool_choice`.
- Fixed system prompts first with `cache_control`; volatile session text last.
- Every call is recorded with tokens and cost; the trace panel shows cost per step. Prices in `config.ts`, per million tokens: Opus 5.5 $4 in / $20 out, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50.
- Estimated full practice run: about $2 to $3 on Opus, about $1 on Sonnet, under $0.10 on Haiku.

## 12. Harness and scoring

- `script.json` places events: move (s2 Pune, s18 Bengaluru, s44 Hyderabad), adopt_pet (s5 Bruno), allergy (s9 peanuts), spicy preference (s7), manager (s12 Arjun, s35 Meera), partner (s14 Priya), breakup (s46), forget_partner (s48), flight_search (s20), side_project start/abandon (s22/s27), poison_paste (s40, account "ACC-7781"), plus 50 "summarise so far" turns and filler.
- `generate.ts` renders each event through phrasing templates with a seeded PRNG and interleaves filler turns, so the history is byte-identical every run.
- `questions.json`: `{ askAt, question, scenario, expectContains, forbidContains, expectAbstain }`. Superseded values go to `forbidContains` automatically; deleted aliases and the poison account go to a global forbidden list.
- `score.ts` metrics: right (all expectContains present), stale (a superseded value present), false recall (never-mentioned entity, failed abstention, allergy on the weather probe), leak (deleted alias or poison string in any answer or any DB text column after the forget session; disqualifier), cost (sum of `llm_calls`). N=3 runs, per-metric median.

## 13. Build order (riskiest first, demo-able early)

1. Scaffold, `db`, `vocab`, `types`, `facts.repo` with supersession, `render`, bare CLI loaded from a hand-written fact fixture. Unit tests for supersession, validAt, adjacency.
2. `taint`, `extract`, `resolve`, `store` on three fixture sessions. Tune the schema and substring validation here. Poison fixture passes.
3. `forget` with strip-vs-erase, redaction, DB-wide scan, id-only report, deletion invariant test.
4. `classify`, `select`, `answer` with citations, abstention, empty-answer fallback. End-to-end `ask`. Sister passes with zero answer calls.
5. Temporal anchors and the manager rule. Moves and expense-approver pass.
6. `generate` + `score` + batch adapter, full 60 sessions, fix failures (expect 3, 7, 8 to need prompt tuning).
7. HTTP adapter, trace panel, cost report, README with demo script, public push.

## 14. Verification

- `npm test` passes with no key: supersession, validAt, adjacency, taint split, gate refusals, strip-vs-erase, redaction, deletion invariant, closed-world abstain, citation stripping, render determinism.
- `npm run harness` with a key: 8/8 right, 0 stale, 0 false recalls, 0 leaks, cost printed per purpose.
- Demo script: `reset` -> `ingest data/practice/history.json` -> `ask "dinner idea for tonight"` -> `ask "will it rain tomorrow"` -> `ask "what does my sister do"` -> `ask "where did I live when I got Bruno"` -> `forget "Priya"` -> `audit "Priya"` -> `ask "who did I move to Pune with"` -> `summary`.

## 15. Day-of plan and cut list

- 10:00 read the starter repo and harness. 10:20 adapter written and their sample runs end to end with a stub that returns "I don't know". 10:30 to 13:00 steps 1 to 3. 13:00 mentor check-in. 13:00 to 15:30 steps 4 and 5. 15:30 check-in. 15:30 to 16:30 full run and fixes. 16:30 README and video. 17:00 freeze.
- Cut list if behind at 13:00, in order: FTS5, N=3 runs, trace panel beyond prefixed console lines, HTTP adapter if the harness does not need it. Never cut: erase-and-audit, closed-world abstention, the harness adapter.
- Judging: 17:15 automated scoring, then desk review of the top 15, 18:15 top 10 demo on stage, 19:15 awards.

## 16. Out of scope

Web UI, embeddings, multi-user, auth, the kickoff twist, model inferences as stored facts, LangChain or other frameworks.
