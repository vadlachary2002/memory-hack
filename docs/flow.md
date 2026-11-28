# Call tree: where a message, a question and a forget go

Files under `src/`. Read top to bottom; indented items are branches.

## A. User types a message

1. Entry: `cli.ts` case `say` builds `{ index: latest + 1, turns: [{ role: 'user', text }] }`; `adapters/http.ts` route `POST /ingest` takes a session JSON. Both call `Memory.ingest` in `memory.ts`.
2. `Memory.ingest` → `ingestSession` in `ingest/ingestSession.ts`.
   1. `rejectKnown`: `turns.hasSession(index)` true → throw, nothing else runs.
   2. `extractPhase` (no database writes).
      1. Each user turn → `splitTurn` in `ingest/taint.ts`: paragraphs → `taintReason`, first match wins: fence → `fence`; From:/Subject:/Forwarded → `forwarded`; `>` line → `quoted`; URL → `url`. Over 400 chars → `readsAsSpeech` (`sentences` split at sentence ends; all at or under 400 → speech, clean; one stretch over 400 with no sentence end → `too_long`, a suspicion). After a fence or header everything following is tainted.
      2. Tainted list split: `too_long` → suspects; anything else → tainted, never seen by a model.
      3. Each clean paragraph → `detectForget` in `ingest/intents.ts`: "forget X" → a `ForgetTarget` is queued and the paragraph dropped from clean; else it stays.
      4. Suspects present → `screenSuspects` in `ingest/screen.ts`, one model call (purpose `screen`, `SCREEN_SYSTEM`): `own` → whole paragraph released to clean; `mixed` → `release` checks the own words are verbatim in the paragraph, then releases only them; `pasted`, no verdict or unknown index → tainted. Released paragraphs are kept in `released` for the transcript.
      5. Clean empty → return, no extract call.
      6. `extractSession` in `ingest/extract.ts`: one model call (purpose `extract`; `llm/provider.ts` routes to Anthropic or Gemini; `EXTRACT_SYSTEM` in `llm/prompts.ts`, rule 4a: "remember that X", "note that X", "my logic for P is X" are statements; a logic, rule, decision or note becomes an `attribute` fact keyed like `logic_duplicate_detection` with the exact wording as object). `validateCandidates` → `validate`, first failure wins: `empty`; quote not in that turn's clean text → `quote_not_in_turn`; object not in quote → `object_not_in_quote`.
   3. `storePhase` (writes, in session order).
      1. `entities.ensureUser`, `turns.addSession`.
      2. Each turn → `storableText(text, released)`: clean paragraph → `dropInstructions` ("remember to", "note to", send, pay, addressed-to-assistant sentences → `[instruction removed]`); released suspect → only the released words; other tainted → `[pasted content removed: reason]` → `scrubAccountNumbers` in `ingest/secrets.ts` → `turns.addTurn`.
      3. `calls.record('extract')`, and `calls.record('screen')` when the screen ran.
      4. Candidates about the user first, then others.
      5. Each candidate:
         1. `resolveObject` in `ingest/resolve.ts`: not relational and not an entity → undefined; else `entities.upsert` with the role implied by the predicate plus `specificRolesIn` from `roles.ts`; existing name or alias → merged.
         2. `storeCandidate` in `ingest/store.ts`:
            1. `gate`: account number → `account_number`; command verb (`INSTRUCTION`: send, pay, transfer, "remember to", "remember not to", "note to", always, never, ignore...) or addressed to the assistant (`ADDRESSED`) on the quote or on the sentence it sits in (`sentenceContaining`) → `not_about_user`. "Remember that I moved" and "remember this logic" pass.
            2. `subjectFor` → `attribute` in `ingest/attribution.ts`: negation about the user → rejected; "Name and I" → user; "my <role> Name" → that person, created with the role; "Name verb" → that person, created as contact, unless the name is the fact's own object → user; leading pronoun → last capitalised name before it, none → rejected; else → user.
            3. `ended` → `facts.closeOpen` → relational → `markFormer` → `closed`.
            4. Else `facts.insert` in `db/facts.repo.ts` (one transaction): `currentFor` open rows with same subject, predicate, attrKey; same value → `noop`; functional predicate → `close` each open row (superseded); insert with `valid_from = session`, domains, tier from `tierOf`; then `markSupersededFormer`.
      6. `detectEndings` in `intents.ts`: "X and I broke up", "broke up with X", "we split up" → `closeOpen(partner_of)` → `markFormer`, even when the extractor missed `ended`.
      7. Each queued `ForgetTarget` → `Memory.forget` (tree C), last so same-session facts are erased too.
      8. `trace('ingest')`, return `IngestReport`.

## B. User asks a question

1. Entry: `cli.ts` case `ask` (`--at N` optional) or `POST /ask` → `Memory.ask` in `memory.ts`.
   1. `asksAboutForgetting` in `recall/deletions.ts` → `describeDeletions` from the deletions log, kinds and counts, no names, no model call. Stop.
   2. Else `ask` in `recall/ask.ts`.
2. `classify` in `recall/classify.ts`: one model call, `CLASSIFY_SYSTEM` → `{ domains, names, roles, timeAnchor }`; a question for a remembered logic, note or decision goes to domains general and work, where the extractor filed it; `calls.record('classify')`.
3. `select` in `recall/select.ts`, pure code:
   1. Names: `entities.byName` → id; unknown but a role word → treated as role; unknown → `abstain: unknown_name`.
   2. Roles: `holdersOf` → `allByRole`; former holders when `asksAboutPast` (`roles.ts`) or nobody current; nobody → `abstain: unknown_role`.
   3. `timeAnchor` → `findAnchor`: earliest fact of that predicate matching name, alias or generic word → `asOf = valid_from`; none → `abstain: unknown_anchor`.
   4. Candidates: `facts.byDomains(reachableDomains(domains), asOf, includeClosed)` (one hop in `vocab.ts`) plus `facts.byEntity` for resolved entities (durable, valid at asOf); newest first; cap 12.
4. Back in `ask`: abstain → "I don't know", no answer call; zero candidates → "I don't have that", no answer call; else `derivationRules` in `recall/rules.ts` → `answer` in `recall/answer.ts`: `buildPrompt` (labelled facts, rules, as-of note, session dates) → one model call, `ANSWER_SYSTEM` → sentences with cited ids → `stripUncited` drops uncited or wrongly cited sentences; nothing left → "I don't have that". `calls.record('answer')`, return.

## C. User forgets

1. Entry: `cli.ts` case `forget`, `POST /forget`, or a queued `ForgetTarget` from ingest → `Memory.forget` → `forget` in `forget/forget.ts`. No model call.
2. Target kind:
   1. `entity` → `forgetEntity`: `resolveEntities` (name or alias via `byName`, else role via `roleFor` and `allByRole`, "my ex" → "former partner").
      1. Several matches → `unambiguous: false`, nothing touched.
      2. None → `forgetName`: erase facts whose object is the name, strip it from other quotes and objects (`redactNames` in `forget/names.ts`), redact turns, `audit`.
      3. One → erase `facts.byEntity` filtered by `isOwned` via `eraseByIds`; strip other mentions via `rewriteText`; `turns.redactByIds`; `entities.erase`; four probes (name, alias, role, summary); `audit` over every text column.
   2. `predicate` or `domain` → `forgetFacts`: erase, redact source turns, `audit`.
3. `Memory.forget`: anything erased or one entity matched → `deletions.record` (kind, counts). Return `ForgetReport`, ids only.
