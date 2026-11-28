# Extended plan: model decides, code verifies

Status: not implemented. The current build (step 16) reads the sentence subject with code in
`src/ingest/attribution.ts` and scores 20/22 (Gemini 3.8 Flash) and 21/22 (Sonnet 5.5) on the
hidden-style cases with zero database leaks, so it stays as it is. This page records the
cleaner design in enough detail to build it in two or three hours if a run ever shows the
regex reader failing on phrasings it has not seen.

## Why

Two kinds of logic live in the ingest path and only one of them belongs in code.

- Invariants belong in code: the quote must appear in the user's text, a deleted name must
  appear nowhere afterwards, an unknown name gets "I don't know", account numbers and
  instruction-shaped text never get stored. A false positive is cheap and the rule is about
  data, not English.
- Language understanding belongs to the model: who a sentence is about, whether it is
  negated or hypothetical, whether a relationship ended. Regexes for this are patched one
  phrasing at a time, which is what `attribution.ts` is today.

Mem0, Zep's Graphiti and Letta all let the model do the understanding and keep code for
storage, deduplication, timestamps and limits. None of them read grammar with regexes.

## The design in four parts

### 1. Ask the extractor a sharper question

Two fields added to `CandidateSchema` in `src/ingest/extract.ts`:

```ts
// The relationship word the user used for the person ("colleague", "sister"); null for the user.
aboutRole: z.string().nullable(),
// "stated" is a fact. "negated" and "hypothetical" store nothing.
polarity: z.enum(['stated', 'negated', 'hypothetical']),
```

Rule 1 of `EXTRACT_SYSTEM` says: "about" is whose life the fact describes; a relationship fact
("my partner Priya", "I report to Meera") is about "me" with the person as object; a pronoun
refers to the last person named; polarity is "negated" for a denial and "hypothetical" for a
wish, plan or condition.

Code invariants on the new fields, in `validate()`:

- polarity other than "stated" is rejected with reason `negated` or `hypothetical`.
- an "about" that is not the user must be one or two capitalised words (a phrase such as
  "Priya and I" is not a person), or a relationship word, and must appear in that turn's clean
  text, else reason `subject_not_in_turn`.

### 2. Verify every candidate with a second cheap call

New purpose `verify` (add to `Purpose` in `src/config.ts`, to `PURPOSES` in
`src/db/calls.repo.ts`, to the effort map in `src/llm/anthropic.ts`, override with
`VERIFY_MODEL`). One call per session, after extraction and validation, inside `extractPhase`
so it runs in parallel with other sessions. Input: the clean text labelled by turn plus a
numbered list of candidates. Output schema:

```ts
{ verdicts: [{ index, subject: 'user' | 'other' | 'nobody', name: string | null,
               role: string | null, negated: boolean, hypothetical: boolean, ended: boolean }] }
```

System prompt (`VERIFY_SYSTEM`): for each candidate read the sentence it came from; "user"
when the fact describes the user's own life (relationship facts included), "other" when it
describes someone else's life, "nobody" for a question, request, instruction, joke or pasted
text; name and role for "other"; negated, hypothetical, ended as booleans; judge only from the
messages, never add facts.

### 3. Reconcile in code, abstain on disagreement

`reconcile(candidates, verdicts)` in a new `src/ingest/verify.ts`, pure and unit-tested:

| Extractor says | Verifier says | Result |
|---|---|---|
| anything | negated or hypothetical | rejected `negated` / `hypothetical` |
| anything | subject nobody | rejected `not_about_user` |
| me | user | stored under the user |
| me | other, and the name is the fact's object ("Neha is my girlfriend") | stored under the user |
| me | other, any other name | rejected `disputed` |
| name X | other, same name | stored under X; verifier's role fills a missing `aboutRole` |
| name X | user, or a different name | rejected `disputed` |
| any | ended true | fact closed (ending is the safe direction, either opinion closes) |
| any | no verdict for this index | extractor's view stands; code invariants still apply |

`subjectFor` in `src/ingest/store.ts` then has no grammar in it: the user, a known person by
name, a person introduced here (created with `aboutRole` and its category, so "brother" also
gives "sibling"), or the single current holder of a role ("my manager"). Anything that cannot
be pinned to exactly one person is rejected, never stored under the user.

`attribution.ts` is deleted. `detectEndings` (closes a partner fact) and `dropInstructions`
(removes a sentence from the stored transcript) stay as safety nets, because the only thing
they can do is close or remove, which can never cause a leak or a poisoned fact.

`FakeClient` answers `verify` with `{ verdicts: [] }` when nothing is queued, so existing
tests keep exercising the extractor path and only the verifier tests queue verdicts.

### 4. Two invariants that stand on their own

These are code rules, independent of the verifier, and each fixes one of the two cases that
still fail today. They can be added without the rest of this plan.

- Need to know for other people's facts, in `select()`: a fact whose subject is not the user
  is handed to the answer step only when the question named that person or a role they hold.
  "What am I allergic to" then never sees the sister's gluten (Sonnet's remaining false recall).
- A redacted hole is never shown, in `ask()`: if the generated answer contains "[redacted]",
  return "I don't have that" (Gemini's "You adopted Simba with [redacted]"). Answer rule 8
  says the same to the model so the guard rarely fires.

## Cost

One extra call per session, about the size of the extraction call's input and a few hundred
output tokens. On the 2,000-session scale run that is roughly another $0.10 on Haiku or Flash.
Point `VERIFY_MODEL` at the cheapest model; agreement between two cheap models is worth more
than one careful model alone.

## Tests to write

- `reconcile`: one test per row of the table above.
- ingest with a queued verdict: extractor says "me", verifier says other "Ravi" → rejected
  `disputed`, no entity created; verifier says ended → partner fact closed and former role set.
- the colleague, negation, sister and "Neha is my girlfriend" cases from
  `tests/hiddenStyle.test.ts`, rewritten to pass `aboutRole` and `polarity` instead of relying
  on `attribute()`.
- select: a sister's fact is dropped for "what am I allergic to" and kept for "what can't my
  sister eat".
- ask: an answer containing "[redacted]" abstains.

## What to tell a judge

No memory system is 100% on language. The model owns understanding and code owns the
invariants. When a model gets a sentence wrong, the fix is a sharper question and a second
opinion, not a rule for that sentence. The code guarantees what must never happen: a deleted
name cannot be recalled, an unknown name gets abstention, pasted text cannot become memory.
Failures degrade to "I don't know", never to a leak.
