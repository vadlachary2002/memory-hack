# Handoff for the next session

Read this first, then `docs/plan.md`. Everything below was true on 22 Nov 2026.

## Where things stand

- Steps 1, 2, 3 of 7 are built and pushed. 53 unit tests, no API key needed. See README for commands.
- Branches, one per step, each based on the previous: `step-1-ledger` (PR into main), `step-2-ingest` (PR into step-1-ledger), `step-3-forget` (PR into step-2-ingest). `main-hi6j98` is the cloud working branch and tracks the latest step. Merge in order; GitHub retargets the next PR when the base branch is deleted.
- The PR title and description for each step live in `docs/prs/0N-*.md` on that step's branch.
- Node 22 is required (better-sqlite3 13, vitest 5). WAL mode is off on purpose; it failed on the user's macOS temp dir.
- `ANTHROPIC_API_KEY` goes in `.env`. No live model run has happened yet; every test uses `src/llm/fake.ts`.

## Build order remaining

4. `recall/classify.ts` (model: question -> domains, names, roles, timeAnchor, closed enums), `recall/select.ts` (adjacency via `reachableDomains` + entity mentions + tier durable, cap 12), `recall/answer.ts` (closed-world check with zero model calls, cited generation, uncited-sentence stripping, "I don't have that" fallback). `Memory.ask`. CLI `ask "<q>" [--at N]`. Tests on the fake client: sister abstains with zero calls, known entity with unknown attribute yields the fallback, weather never gets health candidates.
5. Temporal anchors (`adopted_pet` valid_from -> `validAt`) and the manager rule (current `reports_to` + rule line when no `expense_approver`). Moves and expense-approver scenarios pass.
6. `harness/script.json`, `harness/generate.ts` (seeded, byte-identical), `harness/score.ts` (right, stale, false recall, leak, cost; N=3 median), `adapters/batch.ts`. First live run, expect prompt tuning on scenarios 3, 7, 8.
7. `adapters/http.ts`, trace panel, cost report, README demo script.

## Conventions

- Core is the `Memory` class; adapters only call it. The model is reached only through `LlmClient.structured`.
- Public methods first, helpers below, constants at top, one-line comments, `import type`, no `any`.
- Rules live in code, not prompts: supersession, tiering, taint, the gate, closed-world, citation stripping, erase and audit.
- Reports carry ids only, never names.
- Commit messages end with the Co-Authored-By trailer used in the existing history.

## Hackathon facts

Event Sat 28 Nov 2026, Bengaluru. Harness and starter repo released at 10:00; the first 20 minutes go to an adapter for their interface. Code freeze 17:00. Practice code cannot be reused on the day; this repo is for rehearsal and the design conversation with mentors and judges.
