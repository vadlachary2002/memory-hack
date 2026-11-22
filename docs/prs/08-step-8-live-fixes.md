# PR title

Step 8: fixes from the first live run (transcript never keeps pasted content)

# PR description

## The live run

`npm run harness -- --runs 1` on Claude Opus 5.5, 22 Nov 2026: 13/13 right, 0 stale, 0 false recall, 0 leaks in answers, $0.12 for the full 60-session replay plus 13 questions. The scenario-order CLI demo gave the same picture.

One metric failed: the database-wide scan after the run found a forbidden string. The answers were clean; the raw transcript was not. Session 40's pasted email, including "ACC-7781", was stored verbatim in the turns table because taint only guarded extraction, not storage. Under the hackathon rule "storing a poisoned instruction bars the top three", a judge reading the database could count that.

## What this PR changes

1. `src/ingest/taint.ts`, `storableText`: the text written to the transcript keeps the user's own paragraphs and replaces each tainted paragraph with `[pasted content removed: <reason>]`. Quotes still validate, because they must come from clean paragraphs anyway.
2. `src/ingest/secrets.ts`: the account-number pattern moves out of the gate into one place, and `scrubAccountNumbers` runs on every stored turn, user or assistant. A paste without any markers still cannot leave an account number in the file.
3. `src/ingest/ingestSession.ts`: ingesting a session index that already exists now fails with a clear message instead of a UNIQUE constraint error, and the CLI skips sessions it already has, so `ingest history.json --until 47` followed by `ingest history.json` continues from 48.
4. Tests: the ingest test asserts the poison string and the email header are absent from the transcript and that `audit("ACC-7781")` is clean; the taint test covers `storableText` and the scrubber. 74 tests.

## What to run

```sh
npm test
npm run harness -- --runs 1     # expect leak 0 now
```
