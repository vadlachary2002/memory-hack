# PR title

Step 9: resolve category words, possessives and generic anchors ("when we got that dog")

# PR description

## The gap

Manual testing: "where did I live when we have that dog" abstained with "I don't know" while "when we have Bruno" answered Pune. The classifier produced a time anchor with object "dog"; code then looked for an adopted_pet fact whose text contains "dog", found "Bruno" instead, and treated the anchor as unknown. The closed-world rule was right to refuse an unknown thing; it just had no notion that "dog" names the category Bruno belongs to.

## What this PR changes, all in code

1. `src/roles.ts` is now a lexicon. The relationship-word table grows (boss, lead, supervisor, fiancee, bestie, sis, bro, amma, appa, puppy, kitten, and more), and a second table lists generic words per predicate: adopted_pet has pet, dog, cat, puppy; lives_in has home, place, city; works_at has job, company; partner_of has partner, boyfriend, wife; and so on. `normaliseRef` strips articles ("the", "that", "my") and possessives ("Priya's").
2. Anchors: `findAnchor` in `src/recall/select.ts` treats a generic word, or an empty object, as "any fact of this predicate", earliest first. "When we got that dog" anchors on the adoption; "when I moved" anchors on the first move. A generic word still abstains when no fact of that predicate exists.
3. Names that are really category words: if the classifier puts "dog" or "boss" into names, selection falls back to the role table instead of abstaining. Real unknown names still abstain.
4. `adopted_pet` is now relational in the vocabulary, so every adopted pet becomes an entity with the role "pet" whatever the extractor flagged, and `resolveObject` adds the pet role to any pet entity. "My dog", "my puppy", "that pet" resolve to Bruno in ask and in forget.
5. Answer prompt: never mention session numbers or fact ids in prose. A live answer had said "until about s18".
6. `tests/resolution.test.ts`: lexicon, generic anchors, empty anchors, generic-with-no-fact abstains, category words as names, possessives, unknown names still abstain, "forget my puppy". 83 tests, all earlier tests unchanged.

## Why this is still closed-world

Nothing here guesses. A word resolves only through two fixed tables and the entities and facts that already exist. "My cat" with no pets abstains exactly as before. What changed is that the system now knows the categories its own predicates imply, which is knowledge about the vocabulary, not about the user.

## How to run

```sh
npm test
npm run cli -- ask "where did I live when we got that dog"   # needs ANTHROPIC_API_KEY
npm run cli -- ask "what is my dog called"
npm run cli -- forget "my puppy"
```

## Added after manual testing

- "Who is my partner" after a breakup used to abstain, because nobody holds the role "partner" any more. A role with no current holder now falls back to its former holders, so the answer step receives the closed fact and can say "nobody now; previously Priya". A role nobody ever held still abstains.
- The CLI ingest line now prints `forgotten N` and a FORGET summary for the session, so a forget request carried out from a chat turn is visible. Before this, session 48 looked like an empty session.
