# PR title

Step 5: time anchors and the manager-to-approver rule

# PR description

## What this PR builds

Two mechanisms the moves and new-manager scenarios need, both in code, neither storing anything derived.

## Read in this order

1. `src/recall/select.ts`, `findAnchor`: when the classifier returns a time anchor such as `{ adopted_pet, "Bruno" }`, the selector finds that fact and uses its `valid_from` as the session to answer as of. Every candidate is then fetched with `validAt` semantics, so "where did I live when I got Bruno" sees Pune and not the two later homes. An anchor that matches no fact abstains with "I don't know" and no answer call.
2. `src/recall/rules.ts`: for work or finance questions, the answer call receives one derivation rule. If an explicit `expense_approver` fact exists, it wins. Otherwise the rule says the current manager approves expenses and the model must cite the `reports_to` fact. The derived person is never written to the ledger, so a later manager change cannot leave a stale approver behind.
3. `src/recall/ask.ts`: passes the rules and reports `asOf` on the answer.
4. `tests/temporal.test.ts`: the Bruno question selects Pune only, an unknown anchor abstains, an explicit cutoff works, the manager rule cites Meera and never Arjun, and an explicit approver fact wins.

## Scenarios covered

- Scenario 1 (moved three times): anchor plus `validAt`.
- Scenario 2 (new manager becomes expense approver): derivation at answer time, nothing stored.

## How to run

```sh
npm test
npm run cli -- ask "where did I live when I got Bruno"   # needs ANTHROPIC_API_KEY
npm run cli -- ask "who approves my expenses"
npm run cli -- ask "where do I live" --at 20
```
