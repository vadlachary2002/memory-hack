# PR title

Step 15: parallel extraction and a scale test (thousands of sessions)

# PR description

## Why

The harness proves correctness on 60 sessions. It says nothing about what happens when the transcript is ten thousand turns long: does ingest take an hour, do questions slow down, does the summary still render from facts, does the forget audit still scan everything. This PR makes that measurable.

## What this PR changes

- `src/ingest/ingestSession.ts` is split into two phases. `extractPhase` needs only the session text: taint, forget detection, the one model call, validation. `storePhase` needs the ledger: turns, facts, supersession, forgets, cost. `ingestMany` runs extraction for up to N sessions at a time and then stores strictly in session order, which supersession and forget-ordering require. A test ingests sessions 3, 1, 2 with three parallel workers and checks the validity intervals come out 1-2, 2-3, 3-open.
- A session index that already exists is refused before any model call, in both paths.
- `harness/generate.ts` takes `sessions` and `fillerPerSession`: the fifteen scripted events keep their session numbers, every session after 60 is filler and summary requests, so the thirteen questions still have known answers.
- `harness/scale.ts`, `npm run scale -- --sessions 2000 --filler 2 --concurrency 8`: builds the history, times ingest with parallel extraction, asks the thirteen questions after everything with a timer on each, grades them, checks the summary and the Priya audit, and prints row counts and file size. Cost on Haiku is a few tens of cents for two thousand sessions.
- `npm run cli -- ingest ... --concurrency N` uses the same path and prints elapsed time.
- 110 tests.

## What to look at in the output

- sessions per second during ingest: with concurrency 8 and Haiku, expect several per second; the limit is the model's rate limit, not the database.
- per-question time: expect well under a second of database work; the rest is the two model calls.
- questions right: expect 13/13 even with thousands of sessions between the fact and the question, because selection is by domain and name, not by position.
- summary lines and audit: unchanged by scale, because both read rows, not transcript.

## How to run

```sh
MODEL=claude-haiku-5-5 npm run scale -- --sessions 2000 --filler 2 --concurrency 8
```
