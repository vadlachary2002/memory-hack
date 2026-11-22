# Handoff for the next session

Read this first, then `docs/plan.md`. Everything below was true on 22 Nov 2026.

## Where things stand

- All seven build steps are built and pushed. 73 unit tests, no API key needed. See README for commands.
- Branches, one per step, each based on the previous: `step-1-ledger` (PR into main), `step-2-ingest`, `step-3-forget`, `step-4-ask`, `step-5-temporal`, `step-6-harness`, `step-7-adapters`. `main-hi6j98` is the cloud working branch and tracks the latest step. Merge in order; GitHub retargets the next PR when the base branch is deleted.
- The PR title and description for each step live in `docs/prs/0N-*.md` on that step's branch.
- Node 22 is required (better-sqlite3 13, vitest 5). WAL mode is off on purpose; it failed on the user's macOS temp dir.
- `ANTHROPIC_API_KEY` goes in `.env`. **No live model run has happened yet**; every test uses `src/llm/fake.ts`.

## Next

1. Live run: `npm run harness -- --runs 1`. Read the verdicts. Expect prompt tuning on scenarios 3 (allergy phrasing in the dinner answer), 7 (classifier must put "sister" in roles) and 8 (classifier must not route "trips" to location only). Tune `src/llm/prompts.ts`, never the code rules.
2. Cost: `npm run cli -- cost` after a run. If extraction dominates, set `EXTRACT_MODEL=claude-haiku-5-5` in `.env` and compare. That decision is the user's.
3. Record the 2-minute demo from the README script.

## Conventions

- Core is the `Memory` class; adapters only call it. The model is reached only through `LlmClient.structured`.
- Public methods first, helpers below, constants at top, one-line comments, `import type`, no `any`.
- Rules live in code, not prompts: supersession, tiering, taint, the gate, closed-world, citation stripping, erase and audit, forget-intent detection.
- Reports carry ids only, never names.
- Commit messages end with the Co-Authored-By trailer used in the existing history.

## Hackathon facts

Event Sat 28 Nov 2026, Bengaluru. Harness and starter repo released at 10:00; the first 20 minutes go to an adapter for their interface (library import, CLI, batch file or HTTP, all rehearsed here). Code freeze 17:00. Practice code cannot be reused on the day; this repo is for rehearsal and the design conversation with mentors and judges.
