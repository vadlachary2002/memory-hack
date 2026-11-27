# PR title

Step 14: facts about people in the user's life, and the cheap-model answer rules

# PR description

## Found by running the cases on Claude Haiku

Haiku scored 33 of 36 at $0.005, then 34 of 36 after three answer-prompt rules. The two that remained:

1. "What does my brother do" answered "Your brother is Kiran, but no fact on record says what he does." The ledger stored facts only about the user, so "my brother Kiran works at TCS" became one fact, sibling Kiran, and the employer survived only inside the quote. Opus had kept the whole sentence in the quote; Haiku kept a shorter one. That is a design gap: a judge asking "what does my manager do" or "where does my sister live" hits the same wall.
2. "Where did I live before Delhi" still declined with Mumbai in the prompt, labelled as ended.

## What this PR changes

- `src/ingest/extract.ts`: candidates carry `about`: "me", or the name of the person in the user's life the fact is about. `src/ingest/store.ts` makes that person the subject row. The schema always had a subject column; the extractor was simply never allowed to use it. Facts about strangers are not created under new names.
- `src/render.ts`: a fact about someone else renders with their name, "Kiran: works at TCS", in summaries and in the lines handed to the answer step, so the model cannot mistake it for the user's own job.
- Recall and forget needed no change: `byEntity` already selected facts where the person is the subject, and `forget` already erased them. The test proves both: "what does my brother do" selects his employer, and forgetting the brother erases two facts and abstains afterwards.
- `src/llm/prompts.ts`: extraction allows facts about people in the user's life; the answer prompt gains four rules for smaller models: relationships are symmetric, past questions use closed facts, suggestion questions treat facts as constraints, and session numbers order events. Opus never needed them; Haiku does.
- `src/config.ts`: prices for the Gemini ids the key actually lists: 3.6, 3.7, 3.8 Flash at $0.75 / $3.75, Gemini 4 Argon and Carbon at $2 / $10, and a Flash-Lite estimate for any id containing "lite".
- `tests/others.test.ts`. 107 tests.

## Cost picture so far, same 60 sessions and 13 questions, all 13/13 with zero leaks

| model | cost |
|---|---|
| claude-opus-5-5 | $0.131 |
| claude-sonnet-5-5 | $0.062 |
| claude-haiku-5-5 | $0.006 |

## How to run

```sh
npm test
MODEL=claude-haiku-5-5 npm run cases
npm run compare -- --models claude-haiku-5-5,gemini-3.8-flash,gemini-3.1-flash-lite,gemini-4-argon
```
