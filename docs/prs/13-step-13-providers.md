# PR title

Step 13: Gemini as a second provider, per-purpose routing, and a model comparison script

# PR description

## What this PR builds

The LLM client interface was always one method so a provider could be swapped in one file. This PR adds the second implementation and the routing, so cost can be measured instead of guessed.

- `src/llm/gemini.ts`: Gemini implementation of `LlmClient` with the `@google/genai` SDK. Structured output through `responseJsonSchema`, built from the same zod schemas via `z.toJSONSchema`. The only file that imports the Google SDK, as `anthropic.ts` is the only one that imports Anthropic's.
- `src/llm/provider.ts`: `createClient()` routes each call by the model chosen for its purpose. Any model name starting with `gemini` goes to Gemini, anything else to Anthropic. Both clients are built lazily, so a missing key only fails when that provider is actually needed, with a message naming the variable.
- `src/config.ts`: Gemini prices (`gemini-3-flash-preview` $0.50 / $3, `gemini-3.1-pro-preview` $2 / $12), and the default model follows the keys present: Anthropic's key wins, Gemini's key alone makes Gemini the default. `MODEL` and the three per-purpose overrides still beat both, and they can mix providers: `EXTRACT_MODEL=gemini-3-flash-preview` with `ANSWER_MODEL=claude-opus-5-5`.
- `harness/compare.ts`: `npm run compare -- --models a,b,c` runs the full scored harness once per model and prints one row each: right, stale, false recall, leak, cost. The CLI, the harness and the cases all use the routing client now.
- `tests/provider.test.ts`: routing by name, default by key, per-purpose mixing, prices with fallbacks, the clear error for a missing key, and JSON-schema conversion of the real prompt schemas. 103 tests.

## What is not verified

No Gemini key exists in the cloud session, so the Gemini client has not been run live. The SDK field names were checked against the installed type definitions. The first live run is `npm run cases` with `GEMINI_API_KEY` set and `MODEL=gemini-3-flash-preview`; any schema the model rejects will show up there.

## How to run

```sh
npm test
npm run compare -- --models claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,gemini-3-flash-preview
```
