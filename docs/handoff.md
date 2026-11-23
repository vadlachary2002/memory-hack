# Handoff for the next session

Read this first, then `docs/plan.md`. Everything below was true on 22 Nov 2026.

## Where things stand

- All seven build steps plus two follow-ups (live-run fix, category-word resolution) are built and pushed. 85 unit tests, no API key needed. See README for commands.
- Branches, one per step, each based on the previous: `step-1-ledger` (PR #4 into main), `step-2-ingest` (#5), `step-3-forget` (#6), `step-4-ask` (#7), `step-5-temporal` (#8), `step-6-harness` (#9), `step-7-adapters` (#10), `step-8-live-fixes` (#11), `step-9-resolution` (#12). `main-hi6j98` is the cloud working branch and tracks the latest step. Merge in order; GitHub retargets the next PR when the base branch is deleted.
- The PR title and description for each step live in `docs/prs/0N-*.md` on that step's branch.
- Node 22 is required (better-sqlite3 13, vitest 5). WAL mode is off on purpose; it failed on the user's macOS temp dir.
- `ANTHROPIC_API_KEY` goes in `.env`. The first live run (22 Nov, Opus 5.5) scored 13/13 right, 0 stale, 0 false recall, $0.12 per full replay. Its one finding, pasted content kept in the raw transcript, is fixed in step 8 (`step-8-live-fixes`).

## Next

1. Re-run `npm run harness -- --runs 3` on step 8 and confirm leak 0 with the median.
2. Cost is already low ($0.12 per replay on Opus). Extraction is about 60 percent of it; `EXTRACT_MODEL=claude-haiku-5-5` is an option if the day's budget is tight, but Opus answers were precise and verbatim, so the default stays.
3. Record the 2-minute demo from the README script.
4. On the day: read their harness first, write the adapter, then rebuild in this order: vocab and ledger, taint and extraction with the exact-wording check, forget with audit, closed-world ask, anchors and rules, transcript scrubbing.

## Conventions

- Core is the `Memory` class; adapters only call it. The model is reached only through `LlmClient.structured`.
- Public methods first, helpers below, constants at top, one-line comments, `import type`, no `any`.
- Rules live in code, not prompts: supersession, tiering, taint, the gate, closed-world, citation stripping, erase and audit, forget-intent detection.
- Reports carry ids only, never names.
- Commit messages end with the Co-Authored-By trailer used in the existing history.

## Hackathon facts

Event Sat 28 Nov 2026, Bengaluru. Harness and starter repo released at 10:00; the first 20 minutes go to an adapter for their interface (library import, CLI, batch file or HTTP, all rehearsed here). Code freeze 17:00. Practice code cannot be reused on the day; this repo is for rehearsal and the design conversation with mentors and judges.
