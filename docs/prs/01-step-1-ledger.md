# PR title

Step 1: schema, closed vocabulary, and the fact ledger with supersession

# PR description

## What this PR builds

The storage layer of the Recall & Forget memory system. No model is involved anywhere in this step.

## Read in this order

1. `docs/plan.md`: the design. Sections 2, 3 and 9 explain what the model decides versus what code decides.
2. `src/vocab.ts`: 18 predicates with four flags (functional, durable, relational, ephemeral), 16 domains, and the adjacency matrix. Weather reaches location only, so health can never leak into a weather answer. There is deliberately no predicate that expresses an instruction.
3. `src/db/schema.sql`: six tables. Every time column is a session number; that is the only clock.
4. `src/db/facts.repo.ts`: `insert` closes the previous open row for functional predicates (supersession) and treats an identical open value as a no-op. `validAt` answers "what was true at session N". `byDomains` never returns scratch rows.
5. `src/db/entities.repo.ts`: people and pets with aliases and roles, resolved by name, alias or role.
6. `src/render.ts`: profile and session summaries are string templates over rows, so the same rows always give the same text.
7. `src/fixture.ts` and `fixtures/facts.json`: a hand-written 46-session story replayed without a model, used by the CLI and the tests.
8. `tests/`: 21 tests.

## Scenarios covered

- Scenario 1 (moves): supersession and `validAt`.
- Scenario 4 (mildly spicy): summaries render from rows, never from older summaries.
- Scenario 8 (one-off noise): ephemeral predicates land in the scratch tier and `byDomains` never reads them.

## How to run

```sh
npm install          # Node 22
npm test
npm run cli -- reset
npm run cli -- load fixtures/facts.json
npm run cli -- facts
npm run cli -- summary
```
