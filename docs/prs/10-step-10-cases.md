# PR title

Step 10: live scenario cases with phrasing variants (npm run cases)

# PR description

## Why

Manual testing found three bugs the unit tests could not see: "that dog" did not reach Bruno, "who is my partner" abstained after a breakup, and "who is Priya's partner" fell silent. All three were about how people phrase things, which only shows up with the real model. The 87 unit tests prove the code rules with a fake model and stay fast and free; this PR adds the second kind of test.

## What this PR builds

- `harness/cases.json`: twelve small conversations, each with phrasing variants and graded questions. Partner stated as "lovers", "girlfriend", "husband"; manager as "report to", "boss", "team lead"; a kitten reached by "cat", "pet" and name; moves as "relocated" and "shifted base"; allergy as "can't eat"; a preference that changes; a pasted instruction with no email headers; a known brother and an unknown sister; one-off searches; a fact and its forget in the same session. Several cases also assert that forbidden strings are absent from the database after a forget.
- `harness/cases.ts`: runs each case in a fresh in-memory database, asks the questions at their cutoffs, grades with the same rules as the big harness, scans the database for the forbidden strings, prints PASS or FAIL per question with the answer text, and exits non-zero on any failure. `--only <prefix>` runs a subset.
- `tests/cases.test.ts`: validates the file and runs one case through the fake client.

## How to add a case

Append an object to `harness/cases.json`: `sessions` in the normal input shape, `questions` with `askAt`, `expectContains`, `forbidContains`, `forbidKind` (stale, false_recall or leak) and `expectAbstain`, and optionally `forbiddenInDbAfter`. No code.

## How to run

```sh
npm run cases                      # needs ANTHROPIC_API_KEY; about 5 cents
npm run cases -- --only partner    # one family of cases
```

A failing case is a finding, not a broken build. Fix the rule in code or the prompt, re-run, and keep the case.
