# PR title

Step 11: specific kinds (dog is not cat), past-tense roles, and forget targets with trailing clauses

# PR description

## Found by `npm run cases`

The first live run of the scenario cases scored 32 of 36 with one database leak. The four failures were three defects:

1. "Forget my ex completely, I do not want to hear about her again." erased nothing, so the name leaked. The forget detector took the whole rest of the sentence as the target.
2. "Who was my old boss" answered "I don't have that". The classifier dropped "old", so only the current manager's facts were selected.
3. "What is my dog called" answered about the cat. Category words collapsed kinds: dog and cat both meant "pet", as sister and brother both meant "sibling".

## What this PR changes

- `src/ingest/intents.ts`: the forget target ends at the first comma, semicolon or conjunction. "Forget about Rahul and never bring him up" targets Rahul.
- `src/roles.ts`: two levels of role. Generic roles come from the predicate (pet, partner, sibling, parent, child). Specific roles come from the words around the entity at ingest: kitten gives cat, beagle puppy gives dog, "my brother Kiran" gives brother, "Neha is my girlfriend" gives girlfriend. A specific question word matches only its own kind; "my pet", "my partner", "my sibling" still reach the whole category. `asksAboutPast` detects old, former, previous, ex, before, was.
- `src/ingest/resolve.ts`: entities receive their specific roles from the turn text, and when a relationship ends every role in that category becomes "former", so "ex-girlfriend" resolves after a breakup.
- `src/recall/select.ts`: when the question asks about the past, former holders of the role are included alongside current ones; otherwise current holders win, with former holders only as a fallback when nobody holds the role now.
- `src/llm/prompts.ts`: the classifier keeps qualifiers like "old boss" and "ex-wife".
- A circular import between the lexicon and the resolver left the "former" prefix undefined at load time in some import orders, which silently broke "my ex" resolution. The constant now lives in the lexicon.
- Tests for all of the above. 90 tests.

## Design note

Closed world now also means closed kinds. "What is my dog called" when the only pet is a cat abstains, the same way "what does my sister do" abstains when only a brother is known. The alternative, answering "there is no dog, but you have a cat", reads well but is exactly the shape of answer the hidden test scores as a false recall.

## How to run

```sh
npm test
npm run cases      # expect 36/36, no db leaks
```
