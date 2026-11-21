# Memory Hack practice project — implementation plan

## Context

Nagaraju is selected for the Tipstat Memory Hack (ticket MH26-A9D3D2), a one-day solo hackathon on long-term memory for AI assistants, now on **Saturday 28 November 2026** at WeWork Salarpuria Symbiosis, Bengaluru. Track: **03 Recall & Forget**. Every submission runs on a hidden 60-session user history under a token budget and is checked on 8 published scenarios (moves, new manager, allergy, spicy drift, forget-my-ex, poisoned paste, unknown sister, one-off noise). Hard rule: leaking a deleted fact or storing a poisoned instruction bars the top three.

This practice project exists for three reasons:

1. Prove the Recall & Forget design passes all 8 scenarios on a synthetic history, with a reproducible score and cost.
2. Rehearse the build so it can be rewritten from scratch in ~6 hours on the day (event rules forbid reusing pre-written code).
3. Be a public repo on github.com/vadlachary2002 showing real LLM work.

Decisions made with the user: TypeScript + Node 20, SQLite via better-sqlite3, Anthropic SDK, CLI with a trace panel, new repo at `~/Desktop/Learnings/memory-hack` (confirmed not to exist yet; no memory-related project exists anywhere on disk). No API key is configured on this machine; the user puts one in `.env` (git-ignored).

A design-critique pass was run before this plan; its findings are folded in below (physical erasure instead of tombstones, strip-vs-tombstone rule, closed predicate vocabulary, deterministic summaries, per-session extraction).

## The design in one paragraph

Memory is a ledger of **user-stated facts** with provenance. A fact is `subject, predicate, object, verbatim quote, source turn, valid_from, valid_to, domains`. The predicate comes from a **closed vocabulary** that carries the rules (functional, durable, relational), so supersession, durability, and what can be stored at all are decided by code, not by the model. Summaries and the profile are **template renders of facts**, never LLM text, so nothing can drift. Deletion is entity-scoped and **physical**: object and quote are nulled, mentions in surviving quotes and turns are redacted, then the system probes itself and prints an id-only audit report. Recall is **need-to-know**: facts carry domain tags from write time, questions are classified into domains, and candidates come from a domain adjacency matrix unioned with entity mentions. Answers are **closed-world**: an unknown entity or role returns "I don't know" with no model call, and every sentence must cite a fact id or it is dropped. No embeddings.

## Scenario → mechanism

| # | Scenario | Mechanism |
|---|---|---|
| 1 | Moved three times | `lives_in` is functional: inserting a new value closes the previous row's `valid_to` in code. `valid_from` = session date unless an absolute date is stated. Temporal question: find the anchor fact (`adopted_pet`) `valid_from`, then `lives_in` valid at that date. |
| 2 | New manager → expense approver | Explicit `expense_approver` fact wins if present. Otherwise the answer step receives the current `reports_to` fact and the rule fact "expenses approved by manager" and derives. Never store the derived person. |
| 3 | Allergy → recipe, not weather | `allergic_to` is tagged `health`; adjacency matrix maps health → food, dining, travel, gifts. Weather question classifies to `weather`, no overlap, allergy never a candidate. |
| 4 | Mildly spicy survives summaries | Extraction validation in code: `object ⊆ quote ⊆ turn text`, else the fact is rejected. Summaries are template renders of facts. Answers quote the stored string. |
| 5 | Forget my ex | Resolve entity by name, alias, or role (`partner_of` closed by breakup). Subject-position and relational facts are erased; object-position mentions in user facts are stripped, not deleted (so "Priya and I adopted Bruno" keeps the dog). Turns and surviving quotes redacted by entity id. Self-audit probes: direct, indirect, summary, plus a DB-wide text scan. Report prints ids only. |
| 6 | Poisoned paste | Primary defence: no predicate in the vocabulary expresses "send payments", so it cannot become a fact. Second: spans after fences, URLs, or over 400 chars are tainted and skipped. Third: account-number-shaped strings are refused anywhere. |
| 7 | Sister never mentioned | Question classifier returns roles and names; closed-world check finds no `sibling_of` relation → abstain, zero answer calls. Known entity with unknown attribute: citation stripping empties the answer → "I don't have that". |
| 8 | Flight search, abandoned project | Ephemeral predicates (`searched_for`, `considered`, `started_project`) land in the `scratch` tier and are excluded from recall. An "ended/abandoned" statement closes `valid_to`; recurrence never promotes. |

## Project layout

```
memory-hack/
  package.json (type: module; scripts: test, cli, harness), tsconfig.json, .env.example, .gitignore, README.md
  src/
    config.ts          model ids (env MODEL, default claude-opus-5-5; optional EXTRACT_MODEL/ANSWER_MODEL overrides), prices, thresholds
    vocab.ts           predicate enum with flags {functional, durable, relational, ephemeral}; domain enum; adjacency matrix
    trace.ts           trace printer for every decision (candidates, gate verdicts, citations, cost)
    db/schema.sql      tables below
    db/connection.ts   open, reset, migrate
    db/facts.repo.ts   insert with functional supersession, currentFor, validAt, byDomains, byEntity, eraseByEntity, stripMentions
    db/entities.repo.ts resolve by name/alias/role, upsert, hasRole
    db/turns.repo.ts   store, redactByEntity
    llm/client.ts      Anthropic client; callStructured(purpose, zodSchema, system, user) via messages.parse + zodOutputFormat; records usage to llm_calls
    llm/prompts.ts     prompt constants
    ingest/taint.ts    pure: split user text into clean vs third-party spans
    ingest/extract.ts  one structured call per session over clean spans → candidate facts; validates substring rules; drops violations
    ingest/resolve.ts  entity canonicalisation, alias and role attachment
    ingest/store.ts    gate (vocabulary, taint, account-number refusal), tier routing, ended-statement handling, insert
    ingest/ingestSession.ts orchestrates taint → extract → resolve → store, with trace
    recall/classify.ts LLM: question → domains, names, roles, timeAnchor (closed enums)
    recall/select.ts   adjacency + entity match + optional FTS5 → capped candidate list
    recall/answer.ts   closed-world check, cited generation, uncited-sentence stripping, empty-answer fallback
    forget/forget.ts   resolve → erase/strip → redact → FTS rebuild → probes → DB-wide scan → id-only report
    render.ts          profile and session summary templates from facts
    cli.ts             commands: reset, ingest <history.json> [--until N], ask "<q>" [--at N], forget "<name>", audit "<name>", summary, harness
  harness/
    script.json        hand-written life script: ordered events with session index for all 8 scenarios
    generate.ts        seeded PRNG renders script + filler into data/practice/history.json and questions.json (no LLM, no real data)
    score.ts           replay, ask at cutoffs, metrics, cost; N runs with per-metric median
  data/practice/       generated history.json and questions.json, committed
  tests/               vitest for every pure module; no API calls
```

Style per the user's global rules: public methods first, helpers below, constants at top, one-line comments, `import type`, no `any`.

## SQLite schema (7 tables)

- `sessions(id, idx, started_at)`
- `turns(id, session_id, idx, role, text, redacted_at)` — text nulled on redaction
- `entities(id, canonical_name, type, aliases_json, roles_json, first_session_id, erased_at)` — name and aliases nulled on erase
- `facts(id, subject_entity_id, predicate, object_text, object_entity_id, quote, source_turn_id, session_id, valid_from, valid_to, recorded_at, domains_json, tier, erased_at)` — object_text, quote, object_entity_id nulled on erase; only id, predicate, erased_at remain for lineage
- `facts_fts` — FTS5 over object_text and quote, rebuilt after every erase (optional; entity match alone may suffice)
- `deletions(id, entity_id, request_turn_id, requested_at, report_json)` — ids only
- `llm_calls(id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, session_id, created_at)`

No `derived` table: summaries and profile render on demand from facts. Only user-stated facts are stored; model inferences are not stored at all in this build.

**Deletion invariant**, one function, unit-tested: after `forget(entity)`, no non-erased row in any text column of `facts`, `turns`, `entities`, or `facts_fts` contains the entity's name or any alias, and a DB-wide scan confirms it.

## LLM usage

- Three call types: `extract` (one per session, all clean user turns at once), `classify` (one per question), `answer` (one per question with the cited candidate list). Abstentions and summaries make zero calls.
- Default model `claude-opus-5-5` for all three, effort `low` for extract and classify, `medium` for answer. Per-purpose env overrides exist so the user can move extraction to `claude-haiku-5-5` after seeing the harness cost report. That is the user's call, not a default.
- Structured outputs via `client.messages.parse` with `zodOutputFormat` (verified present in SDK 0.133.0), using enums for predicate, domain, and role so shapes are deterministic. No forced `tool_choice`.
- Fixed system prompts first with `cache_control`, volatile session text last.
- Every call is recorded with tokens and cost; the trace panel shows cost per step.

## Harness and scoring

- `script.json` places events: move (s2 Pune, s18 Bengaluru, s44 Hyderabad), adopt_pet (s5 Bruno), allergy (s9 peanuts), partner (s14 Priya), manager (s12 Arjun, s35 Meera), spicy preference (s7 "mildly spicy"), flight_search (s20), side_project start/abandon (s22/s27), poison_paste (s40, account "ACC-7781"), forget_partner (s48), plus 50 "summarise so far" turns for drift.
- `generate.ts` renders each event through per-event phrasing templates with a seeded PRNG and interleaves filler turns, so the history is byte-identical every run.
- `questions.json` is derived from the same script: `{askAt, question, scenario, expectContains, forbidContains, expectAbstain}`. Superseded values go to `forbidContains` automatically; deleted aliases and the poison account go to a global forbidden list.
- `score.ts` metrics: right (all expectContains present), stale (a superseded value present), false recall (never-mentioned entity, failed abstention, or allergy on the weather probe), leak (deleted alias or poison string in any answer or any DB text column after the forget session; disqualifier), cost (sum of `llm_calls`). Runs N=3 and reports per-metric median since model output is non-deterministic.

## Build order (riskiest first, demo-able early)

1. Scaffold, `db`, `vocab`, `facts.repo` with functional supersession, `render`, bare CLI loaded from a hand-written fact fixture. Unit tests for supersession and validAt.
2. `taint`, `extract`, `resolve`, `store` on three fixture sessions. Tune the schema and substring validation here; if extraction is sloppy nothing downstream is trustworthy. Poison fixture passes.
3. `forget` with strip-vs-erase rule, redaction, DB-wide scan, id-only report, and the deletion invariant test. Proven on the fixture before the harness exists.
4. `classify`, `select`, `answer` with citations, abstention, empty-answer fallback. End-to-end `ask` works. Sister passes with zero answer calls.
5. Temporal anchors and the manager rule. Moves and expense-approver pass.
6. `generate` + `score`, run the full 60 sessions, fix failures (expect 3, 7, 8 to need prompt tuning).
7. Trace panel, cost report, README (design, declared libraries, demo script), public push to github.com/vadlachary2002 from the Terminal panel (needs the SSH passphrase).

## Verification

- `npm test` passes with no key: supersession, validAt, taint split, gate refusals, strip-vs-erase, redaction, deletion invariant, closed-world abstain, citation stripping.
- `npm run harness` with `.env`: 8/8 right, 0 stale, 0 false recalls, 0 leaks, total cost printed. Target under roughly $3 per run on the default model.
- Demo script in README: `reset` → `ingest data/practice/history.json` → `ask "dinner idea for tonight"` (peanut allergy shapes it) → `ask "will it rain tomorrow"` (no allergy) → `ask "what does my sister do"` (abstain) → `ask "where did I live when I got Bruno"` (Pune) → `forget "Priya"` → `audit "Priya"` (pass) → `ask "who did I move to Pune with"` (no leak) → `summary`.

## Risk review against the hidden test (added 20 Nov after re-reading the live brief)

The brief, re-fetched on 20 Nov: event is Sat 28 Nov, applications now close 22 Nov, seats confirmed by 25 Nov. Rules unchanged: solo, fresh repo after kickoff, all code written on the day, AI assistants allowed, judges may ask you to explain any line. Scoring harness and starter repos are released at 10:00; the build "must run on the scoring harness". Models: "any". Partners, judges and the twist are still unannounced.

What that changes in the design:

1. **The harness interface is unknown until 10:00.** The core must be a library with four entry points, `ingest(session)`, `ask(question, asOfSession?)`, `forget(target)`, `summarise()`, and nothing else may depend on the CLI. The CLI and the practice scorer are adapters. On the day, the first 20 minutes go to writing one adapter for their harness. If the harness is not met, the hidden test scores zero regardless of quality.
2. **The model partner is unknown.** `llm/client.ts` becomes an interface with one method, `structured(purpose, schema, system, user)`, and an Anthropic implementation. If credits come from another provider, only that file is rewritten. Prompts must not rely on Anthropic-only features; structured JSON is the only requirement.
3. **A fully closed predicate vocabulary will drop hidden scenarios.** Keep the closed set for the predicates the rules depend on (`lives_in`, `reports_to`, `expense_approver`, `allergic_to`, `partner_of`, `sibling_of`, `adopted_pet`, `prefers`, ephemeral ones). Add one open predicate `attribute` with a free-text `key`, durable by default, so "switched to iPhone" or "daughter's birthday" still store. Instructions are blocked by a separate check that the fact is a statement about the user, not by vocabulary alone.
4. **Deletion may be scoped by topic, not only by person.** `forget(target)` accepts an entity, a predicate, or a domain. Same erase and audit path.
5. **Session dates may be absent.** Fall back to session index as the time axis; temporal queries then compare indices.
6. **Cost is scored but the budget figure is not published.** Estimated at Opus 5.5 prices: 60 extractions at roughly $0.03 each plus 100 questions at roughly $0.02 each is about $4 per full run. The practice harness prints exact cost per purpose, and per-purpose model overrides let extraction and classification move to a cheaper model if the number is high. That decision is made from the measured number, not guessed.
7. **Hidden summarisation loops are harmless.** If the harness asks for a summary 50 times, each call renders from facts and returns the same text; nothing is fed back.
8. **Time on the day is 6h45m.** Cut list, in order, if behind at the 13:00 check-in: FTS5, N=3 scoring runs, the trace panel beyond prefixed console lines. Never cut: erase-and-audit, closed-world abstention, the harness adapter.

## Judging flow to rehearse for

17:00 code freeze with repo, README and 2-minute video from everyone. 17:15 the hidden test scores every build automatically. Judges then review the top 15 at their desks, so expect to walk a judge through the design and code. 18:15 the top 10 demo live on stage for 5 minutes. 19:15 awards. Two mentor check-ins at 13:00 and 15:30 are also conversations about the design. The practice build is the rehearsal for all four of those conversations.

## Out of scope

Web UI, embeddings, multi-user, auth, the kickoff twist, model inferences as stored facts.
