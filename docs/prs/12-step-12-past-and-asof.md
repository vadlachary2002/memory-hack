# PR title

Step 12: questions about the past, answers as of a session, and the deletion log

# PR description

## Found by the ten-stage manual walk

Forty-three questions over the practice history: forty-one right, two wrong, both in the same area.

1. "Where did I live before" said "I don't have that". The past marker only widened role lookups; domain selection still fetched open facts only, so Pune, closed at session 18, was never a candidate.
2. "Where do I live --at 10" said "you lived in Pune until recently". Pune was selected correctly as valid at session 10, but its label still read "(s2 to s18)", so the model treated it as ended.

A third item was a known gap: "who did I ask you to forget" returned "I don't have that".

## What this PR changes

- `src/db/facts.repo.ts`, `byDomains` takes `includeClosed`. `src/recall/select.ts` passes it when the question asks about the past, so closed facts become candidates for "before", "old", "used to", "was".
- `src/recall/answer.ts`: when answering as of a session, every candidate is labelled relative to that session: "current as of s10, since s2" or "ended at s18, before s30", and the prompt says to answer as of that session. Without a session the labels are unchanged.
- `src/db/deletions.repo.ts` and `src/recall/deletions.ts`: every forget that erased something is recorded by kind and counts, never a name. A question about forgetting is detected in code and answered from that log with no model call: "Yes. In session 48 you asked me to forget one person (1 fact erased, 3 messages redacted). I no longer know who or what that was; the record keeps only counts." With no deletions: "No. You have not asked me to forget anything."
- `tests/past.test.ts`: closed homes offered for a past question and not for a present one, as-of labels, the forget-question detector, the log answer with no name and zero calls, and no record for a forget that resolved nobody. 97 tests.

## Why the deletion log is not a leak

The log is written after the audit passes and contains the kind of target, the session, and four counts. A judge asking "whom did you forget" gets a confident, truthful answer that proves the forget happened and proves the name is gone, in one sentence.

## How to run

```sh
npm test
npm run cli -- reset && npm run cli -- ingest data/practice/history.json --until 18
npm run cli -- ask "where did I live before"      # Pune
npm run cli -- ask "where do I live" --at 10      # Pune, as current then
npm run cli -- ingest data/practice/history.json --until 48
npm run cli -- ask "who did I ask you to forget"  # one person, session 48, no name
```
