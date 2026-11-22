# PR 1 title

Steps 1-2: fact ledger, vocabulary, and the ingest pipeline

# PR 1 description

## What this PR builds

The foundation of the Recall & Forget memory system: a ledger of user-stated facts with provenance, the closed vocabulary that carries the rules, and the ingest pipeline that turns a chat session into validated facts with one model call.

## Read in this order

1. `docs/plan.md`: the design. Sections 2, 3 and 9 explain what the model decides versus what code decides.
2. `src/vocab.ts`: 18 predicates with flags (functional, durable, relational, ephemeral), 16 domains, and the adjacency matrix. Weather reaches location only, so health can never leak into a weather answer.
3. `src/db/schema.sql`: six tables. Every time column is a session number; that is the only clock.
4. `src/db/facts.repo.ts`: `insert` closes the previous open row for functional predicates (supersession) and treats an identical open value as a no-op. `validAt` answers "what was true at session N".
5. `src/ingest/taint.ts`: splits a user turn into the user's own paragraphs and pasted text (fences, email headers, quoted lines, links, over-long paragraphs). Tainted text never reaches the model.
6. `src/ingest/extract.ts`: one structured call per session over clean spans, then code enforces object inside quote inside turn text. Paraphrases are rejected.
7. `src/ingest/store.ts`: the gate. Account-number shapes and instruction-shaped text are refused, ephemeral predicates go to the scratch tier, "ended" statements close facts instead of inserting.
8. `src/memory.ts`: the library surface. `ingest`, `summarise`, `reset`, `cost` work; `ask` and `forget` arrive in later PRs. `Memory.forUser` gives each user its own database file, so isolation is a file boundary rather than a query filter.
9. `src/llm/`: one interface with one method, an Anthropic implementation, and a fake client for tests.
10. `tests/`: 42 tests, no API key needed.

## Scenarios covered so far

- Scenario 1 (moves): supersession and `validAt` in `facts.repo.ts`.
- Scenario 4 (mildly spicy): substring validation in `extract.ts`; summaries render from rows in `render.ts`.
- Scenario 6 (poisoned paste): `taint.ts` cuts the paste, `store.ts` refuses the account number, and the vocabulary has no predicate an instruction fits. `tests/ingest.test.ts` feeds the fake model deliberately bad output and nothing from the email lands.
- Scenario 8 (one-off noise): ephemeral predicates land in scratch and `byDomains` never reads them.

## How to run

```sh
npm install          # Node 22
npm test
npm run cli -- reset
npm run cli -- load fixtures/facts.json
npm run cli -- summary
```

With `ANTHROPIC_API_KEY` in `.env`: `npm run cli -- ingest fixtures/sessions.json` then `npm run cli -- cost`.

## Not in this PR

Forget and the deletion audit (step 3), classify/select/answer with closed-world abstention (step 4), temporal anchors and the manager rule (step 5), the 60-session harness and scorer (step 6), adapters and trace panel (step 7).
