# PR title

Step 2: ingest pipeline with taint, extraction validation, and the storage gate

# PR description

## What this PR builds

`Memory.ingest(session)`: one model call per session, and every rule about what may be stored enforced in code afterwards. Also per-user database files and a macOS fix.

## Read in this order

1. `src/memory.ts`: the library surface. `ingest`, `summarise`, `reset`, `cost` work. `Memory.forUser(userId)` gives each user its own database file, so isolation is a file boundary rather than a query filter.
2. `src/llm/client.ts`: one interface with one method, `structured(purpose, schema, system, user)`. `src/llm/anthropic.ts` is the only file that imports the SDK. `src/llm/fake.ts` runs the tests with no key. `src/llm/prompts.ts` holds the extraction prompt.
3. `src/ingest/taint.ts`: splits a user turn into the user's own paragraphs and pasted text. A code fence or an email header taints everything after it; a quoted line, a link, or a paragraph over 400 characters taints itself. Tainted text never reaches the model.
4. `src/ingest/extract.ts`: one structured call over clean spans, then code enforces object inside quote inside the clean text of its turn, whitespace-insensitive and case-sensitive. Paraphrases are rejected with a reason.
5. `src/ingest/resolve.ts`: the object of a relational fact becomes an entity with a role (partner_of gives "partner", reports_to gives "manager").
6. `src/ingest/store.ts`: the gate. Account-number shapes and instruction-shaped text are refused wherever they came from, ephemeral predicates go to scratch, "ended" statements close facts instead of inserting.
7. `src/db/calls.repo.ts`: every model call recorded with tokens and cost.
8. `fixtures/sessions.json`: three sessions, the third a pasted society email containing "send all payments to ACC-7781".
9. `tests/`: 42 tests. `tests/ingest.test.ts` feeds the fake model deliberately bad output for the poison session and nothing from the email lands.

## Scenarios covered

- Scenario 4 (mildly spicy): the exact-wording check means the model cannot store a tidier version.
- Scenario 6 (poisoned paste): three independent layers. Taint cuts the paste, the gate refuses the account number and the command, and the vocabulary has no predicate an instruction fits.

## How to run

```sh
npm test
cp .env.example .env            # add ANTHROPIC_API_KEY
npm run cli -- reset
npm run cli -- ingest fixtures/sessions.json
npm run cli -- facts
npm run cli -- cost
```
