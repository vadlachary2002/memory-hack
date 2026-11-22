# PR title

Step 6: forget requests in chat, the seeded 60-session harness, and the scorer

# PR description

## What this PR builds

The practice version of the hackathon's hidden test: a byte-identical 60-session history covering all 8 scenarios, a scorer that grades every answer and prints cost, and the one missing core behaviour it exposed: a "forget ..." request that arrives as an ordinary chat message.

## Read in this order

1. `src/ingest/intents.ts` and `src/ingest/ingestSession.ts`: a user turn that says "forget everything about my ex" is an instruction, not a fact. It is detected in code, never sent to extraction, and carried out through the same erase-and-audit path as `Memory.forget`. It runs after the session's facts are stored, so anything said earlier in the same session is erased too. The ingest report lists what was forgotten, ids only.
2. `harness/script.json`: the life script. Fifteen scripted events placed across sixty sessions (moves at 2, 18, 44; Bruno at 5; spicy at 7; allergy at 9; managers at 12 and 35; Priya at 14, breakup at 46, forget at 48; flights at 20; side project at 22 and 27; poisoned paste at 40), fifteen filler lines, and thirteen questions with what they must contain, must not contain, and whether they must abstain.
3. `harness/generate.ts`: a seeded PRNG renders the script into `data/practice/history.json` and `questions.json`. Same seed, same bytes, so a test pins the committed data to the generator. Fifty sessions carry a "summarise what you know" turn to provoke drift.
4. `src/adapters/batch.ts`: ingest sessions in order and ask each question right after the session it names. This is the adapter shape the scorer uses and the likely shape of the real harness.
5. `harness/score.ts`: `grade` is pure: a forbidden string in the answer scores as stale, false recall or leak depending on the question; an abstain question passes only on "I don't know" or "I don't have that". After the run, `Memory.audit` scans the database for the deleted names and the poison account; any hit is a leak. N runs report the per-metric median. `npm run harness -- --runs 3` needs `ANTHROPIC_API_KEY`.
6. `tests/harness.test.ts`: intent detection, generator determinism against the committed data, grading rules, leak accounting around the forget session, and a batch run where the forget arrives as a chat turn and the follow-up question abstains.

## What is not verified in this PR

The live run against Opus 5.5 has not been executed in the cloud session because no API key is configured there. Everything above is proven with the fake client. The first live run is the next thing to do on a laptop with a key; expect prompt tuning on scenarios 3, 7 and 8.

## How to run

```sh
npm test
npm run generate                 # rewrites data/practice from the script, deterministic
npm run harness -- --runs 1      # needs ANTHROPIC_API_KEY; prints verdicts and cost
```
