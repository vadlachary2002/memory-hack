# PR title

Step 4: ask with closed-world abstention, need-to-know selection and cited answers

# PR description

## What this PR builds

`Memory.ask(question)`: two model calls at most, and every decision about whether and what to answer made in code.

## Read in this order

1. `src/recall/classify.ts`: one structured call turns the question into domains, names, roles and an optional time anchor, all from closed enums. The model never sees a fact here.
2. `src/recall/select.ts`: the closed-world check and the candidate list. Every name must resolve to a non-erased entity and every role (via `src/roles.ts`) to someone carrying it, or the answer is "I don't know" with no further call. Candidates are facts tagged with the question's domains expanded by one hop of adjacency, plus facts about the named people, durable tier only, capped at 12.
3. `src/recall/answer.ts`: the answer call receives only the candidate lines, each with its id and quote. Every sentence must cite ids. `stripUncited` drops any sentence with no citation or with an id outside the candidates; an empty result becomes "I don't have that".
4. `src/recall/ask.ts`: the orchestration and cost recording. Abstentions and empty selections cost one classify call and nothing else.
5. `src/roles.ts`: the relationship-word table, now shared by forget and ask.
6. `src/llm/prompts.ts`: the classify and answer prompts. Short on purpose.
7. `tests/ask.test.ts`: sister abstains with zero answer calls, a forgotten name abstains, the weather question never receives the allergy and a sloppy model's mention is filtered out, the dinner question receives the allergy and the spice preference, a known person with no matching fact gets the fallback, and the citation filter is tested on its own.

## Why this is the honesty mechanism

Hallucination is turned into a filter: the model cannot invent a sister because the question never reaches the answer step, and it cannot invent Meera's weekend hobby because the sentence carries no fact id and is dropped. The allergy cannot appear in a weather answer because it was never in the prompt.

## Scenarios covered

- Scenario 3 (allergy shapes dinner, not weather): adjacency in `select.ts`.
- Scenario 7 (sister never mentioned): closed-world check, zero answer calls; the known-entity variant falls to the citation filter.
- Scenario 5 (forget my ex): after the forget, "who did I move to Pune with" abstains.

## How to run

```sh
npm test
npm run cli -- reset && npm run cli -- load fixtures/facts.json
npm run cli -- ask "will it rain tomorrow"        # needs ANTHROPIC_API_KEY
npm run cli -- ask "what does my sister do"
```

## Not in this PR

Temporal anchors and the manager rule (step 5).
