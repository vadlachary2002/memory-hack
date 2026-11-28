# Recall & Forget: a fact ledger with physical deletion

Design submission, Tipstat Memory Hack 2026, track 03. Author: Nagaraju Vadla.
This is the design I will build today. The implementation follows it step by step; any change
forced by the kickoff twist is recorded in section 9 before code is written.

## 1. Problem

An assistant that remembers across many sessions must do three things that pull against each
other: forget completely when asked, bring a memory up only when it helps, and say "I don't
know" about anything never mentioned. The usual failure is a summary that cannot be partially
deleted, a retrieval step that fetches whatever is similar, and an answer step that fills gaps.

## 2. Principle

The model owns language. Code owns the invariants. The model extracts facts, classifies
questions and phrases answers. Code decides what is stored, what is fetched, what is deleted,
and checks every model output against the user's own words. Every failure degrades to
"I don't know", never to a leak or a planted fact.

## 3. Memory model

A memory is a row in a ledger, not a paragraph.

| field | meaning |
|---|---|
| subject | the user, or a person or pet in the user's life (an entity row with roles) |
| predicate | one of 18 fixed labels, each with rules: one-value-at-a-time, object-is-a-person, passing-activity |
| object | the value, copied verbatim from the user's words, or an entity |
| quote | the exact sentence it came from |
| valid_from, valid_to | session numbers; a change closes the old row and opens a new one; nothing is overwritten |
| domains | topics the fact may be shown for (location, health, work, ...) |
| tier | durable (recalled) or scratch (passing activity, never recalled) |

Four stores: sessions (the clock), turns (the scrubbed transcript, kept as evidence and never
read for recall), facts (the ledger), entities (people and pets with roles such as partner,
manager, dog, former partner). Summaries are rendered from facts on demand and never stored,
so nothing derived can outlive a deletion.

## 4. Pipeline

Ingest, per session:

1. Taint, in code. Fenced blocks, forwarded headers, quoted lines and URLs are cut and never
   reach a model. A long paragraph of ordinary sentences is speech and passes. A long run with
   no sentence breaks is screened by one cheap model call that can only release the user's own
   words, never add.
2. Extract, one model call. Candidates with subject, predicate, object, verbatim quote,
   polarity, and whether the fact ended.
3. Validate and gate, in code. The quote must appear in the user's text and the object inside
   the quote. Account numbers, instruction-shaped sentences, negations, hypotheticals and
   placeholder values are refused. A fact about another person is stored under that person;
   one the ledger cannot place is refused, never pinned on the user.
4. Store. A one-value predicate closes the old row at this session. A relationship ending
   turns the person's role into "former". A forget request found in the chat is carried out
   last, so same-session facts are erased too.

Ask, per question:

1. Classify, one model call: topics, named people, roles, and any time anchor ("when I got
   the dog").
2. Select, in code. Closed world: a name, role or event the ledger has never seen returns
   "I don't know" with no answer call. Otherwise fetch facts in the question's topics plus one
   adjacent hop (health reaches food, never weather), plus the facts of anyone named, as of the
   anchor session, newest first, capped at twelve. Other people's facts appear only when the
   question names them.
3. Answer, one model call. Every sentence must cite fact ids; uncited sentences are dropped in
   code. Closed facts answer "before" questions; session dates answer "when".

Forget: resolve the target by name, alias or role ("my ex" is the former partner). Erase the
person's facts (text columns nulled, ids kept for lineage), strip the name from every other
fact's quote, redact every turn that carries it, erase the entity. Then prove it: probe by
name, alias and role, scan every text column and the rendered summary. The report carries ids
and counts only, never the name. Ambiguity touches nothing and asks.

## 5. Guarantees enforced in code

1. A stored fact's quote is in the user's own text; its object is in the quote.
2. Pasted material never reaches extraction and is replaced in the transcript.
3. Account numbers are never stored anywhere.
4. Instruction-shaped sentences are refused and removed from the transcript.
5. A question about an unknown person, role or event gets "I don't know" with zero answer calls.
6. Every answer sentence cites a fetched fact or is dropped.
7. Forget is physical, scoped to the entity, and self-audited; a redacted hole is never shown.
8. Summaries are computed, never stored.
9. Every model call is recorded with its cost.

## 6. Interfaces

Library: `Memory.ingest(session)`, `ask(question, as_of)`, `forget(target)`, `audit(name)`,
`summarise()`, `cost()`. CLI: `say`, `ask`, `forget`, `audit`, `facts`, `summary`, `cost`,
`serve`. HTTP: `POST /ingest`, `POST /ask`, `POST /forget`, `GET /summary`, `GET /audit`,
`GET /cost`, `GET /health`. One SQLite file per user. Python 3.12, standard-library sqlite3,
pydantic, FastAPI, in Docker.

## 7. Evaluation I will run before submitting

Unit tests with a fake model client cover every rule above without an API key. A live case
file replays the published scenarios and organiser-style traps: moves and "before" and "two
moves ago", preference reversal, manager and expense approver, allergy for dinner but not for
weather, partner and breakup and "forget my ex" probed sideways through the dog's vet, pasted
email with an account number, a plain-prose instruction, a colleague's move, a negated allergy,
hypotheticals, a same-session correction, dated sessions and "when", "remember this logic",
long dictated speech, an unbroken form dump. Each run reports questions right, stale answers,
false recalls, leaks in answers, leaks in the database, and cost per question.

## 8. Build order today

Ledger and schema; taint, extract, gate, store; classify, select, answer; forget and audit;
time anchors and dates; screen step and HTTP; live cases and numbers; README and video.
If behind, the screen step and per-user files are cut first. The quote check, the gate,
closed-world abstention, citation stripping and physical forget with audit are never cut.

## 9. Kickoff twist and changes to this plan

(filled in at 09:45)

## 10. Known limits

Dates come from the session, not from words in a sentence, so "in 2024" is answered from when
it was said. Pasted blocks are never memory, even when introduced with "remember this". A fact
the extractor misses is a missed recall, not a wrong one. With one more day: a second cheap
model call confirming the subject of every extracted fact before it is stored.

## 11. Sources, and what this design takes from each

I read the three systems people name when they say "agent memory", two benchmarks, and one
older paper, before fixing this design. Nothing here is copied; each choice below says what
was borrowed and what was rejected.

**Mem0** (Mem0 Inc, San Francisco; open-source memory layer launched in 2024 out of the
earlier Embedchain project; paper "Mem0: Building Production-Ready AI Agents with Scalable
Long-Term Memory", 2025). Pattern: one model call extracts short facts from the conversation;
a second model call compares each new fact with similar stored memories and decides ADD,
UPDATE, DELETE or NONE; facts live in a vector store with an optional graph.
Taken: extraction into short atomic facts rather than summaries; "what changed" as an explicit
update decision per fact. Rejected: letting a model make the update decision. Here the
predicate's rules make it in code (one-value predicates close the old row), so a change is
deterministic and auditable. Also rejected: vector similarity as the retrieval gate, because
similarity fetches the allergy for a weather question.

**Zep and Graphiti** (Zep, founded 2023 by Daniel Chalef; Graphiti open-sourced in 2024;
paper "Zep: A Temporal Knowledge Graph Architecture for Agent Memory", 2025). Pattern: each
episode goes to a model that extracts entities and relationships into a graph; every edge is
bi-temporal, with the time it became true, the time it stopped, and the time it was recorded;
old edges are invalidated, never deleted; retrieval mixes text, embedding and graph search.
Taken: the bi-temporal edge. This ledger's valid_from and valid_to by session, "close, never
overwrite", and entities with roles are Graphiti's idea reduced to one SQLite table. Rejected:
invalidation as the only form of removal. The track demands deletion that removes everything
learnt, so forget here is physical, scoped to the entity, and proven by a scan.

**Letta, formerly MemGPT** (UC Berkeley paper "MemGPT: Towards LLMs as Operating Systems",
2023, Charles Packer and Sarah Wooders; company founded 2024). Pattern: the agent holds small
memory blocks inside its context and edits them itself through tools, paging older material in
and out of archival storage like an operating system.
Taken: the separation of a small always-visible profile from a larger store that is searched
on demand; here the rendered profile versus the ledger. Rejected: the agent writing its own
memory. A model with a write tool is exactly the path by which a pasted instruction becomes a
stored rule. In this design no model call can write to the database.

**LOCOMO** (Snap Research, 2024): a long-conversation memory benchmark with multi-session
dialogues and questions on single-hop, multi-hop, temporal and open-domain recall, plus
adversarial questions whose answer is not in the conversation. **LongMemEval** (2024): tests
information extraction, multi-session reasoning, temporal reasoning, knowledge updates and
abstention. Taken: the question categories became the harness categories here: current value,
value before a change, value at an anchored time, updates, abstention on things never said.
Both benchmarks reward abstention explicitly, which is why "I don't know" is a first-class
answer with its own code path and zero model calls.

**Generative Agents** (Park et al., Stanford, 2023): memory stream with recency, importance
and relevance scores, and periodic "reflection" that writes summaries back into memory.
Rejected on purpose: written-back reflections are derived memory that cannot be partially
deleted. Summaries here are rendered from facts every time and never stored.

**Right to erasure** (GDPR Article 17) and the machine-unlearning literature: the standard
for "forgotten" is that the data and what was derived from it are gone, and that this can be
demonstrated. That standard is the forget contract here: erase, strip, redact, then probe and
scan, with a report that carries ids and counts only.

In one line: Mem0's atomic facts, Graphiti's bi-temporal edges, Letta's small profile over a
larger store, and the benchmarks' abstention category, with the model kept out of the write
path and deletion made physical and provable.
