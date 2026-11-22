# PR title

Step 3: forget with physical erase, strip, redaction and self-audit

# PR description

## What this PR builds

`Memory.forget(target)` and `Memory.audit(name)`. Forgetting is physical and entity-scoped, and the system proves to itself that nothing is left before it reports. No model call is involved anywhere in this path.

## Read in this order

1. `src/forget/names.ts`: whole-word, case-insensitive name matching and redaction. Alias "Pri" must not hit "price".
2. `src/forget/forget.ts`: the whole flow.
   - `resolveEntities` turns "Priya", "Pri", "my ex", "my old manager", "my dog" into entity rows. Names and aliases first, then a synonym table from everyday words to roles. "ex" means the role "former partner".
   - `forgetEntity` erases facts where the person is the subject or the relational object (content columns set to NULL, id and predicate kept for lineage), strips passing mentions in other quotes ("Priya and I adopted Bruno" becomes "[redacted] and I adopted Bruno" and Bruno stays), redacts raw turns, and nulls the entity's name, aliases and roles.
   - Four probes then run: resolve by name, by alias, by role, and render the summary. Then `audit` scans every text column. The report has ids only; a test asserts the JSON never contains the name.
   - Several matches for a role mean ambiguity, and nothing is erased.
   - `forgetFacts` handles predicate and domain targets: erase the facts and redact their source turns.
3. `src/ingest/resolve.ts`: `markFormer` and `markSupersededFormer`. When a relational fact closes or is superseded, the person's role becomes "former X". This is what lets "my ex" and "my old manager" resolve without storing those words anywhere.
4. `src/db/connection.ts`: `PRAGMA secure_delete` so freed pages are zeroed on disk.
5. `src/db/*.repo.ts`: `eraseByIds`, `rewriteText`, `redactByIds`, `erase`, `allByRole`.
6. `tests/forget.test.ts`: forget my ex end to end, idempotence, by name, by relation words, ambiguity, unknown person, by predicate, by domain, and the deletion invariant test that walks every text column. 53 tests in total.
7. `docs/handoff.md`: status, conventions and the remaining steps for whoever picks this up next.

## Update versus forget, for the judges

Supersession closes a row and keeps it, because the user only said something changed. Forget erases content, because the user asked for removal. The breakup at session 46 is supersession; "forget my ex" at session 48 is the erase. Only an explicit request moves a fact from the first state to the second.

## Scenario covered

Scenario 5 (forget my ex): resolve through the closed `partner_of` fact, erase versus strip, redaction, probes, scan, id-only report. "Who did I move to Pune with" after the forget has no entity to find.

## How to run

```sh
npm test
npm run cli -- reset
npm run cli -- load fixtures/facts.json
npm run cli -- audit Priya       # FAIL before
npm run cli -- forget "my ex"
npm run cli -- audit Priya       # PASS after
npm run cli -- facts
```
