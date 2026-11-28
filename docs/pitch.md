# The pitch: mentor review at lunch, judge walk-through, finals demo

## One paragraph, spoken

I store what the user says as a ledger of facts, not as summaries. Each fact has the exact quote it came from, the session it started, and the session it stopped being true, so a move or a breakup closes the old fact instead of overwriting it. Recall is need-to-know: a question is classified into a topic, only facts in that topic and its neighbours are fetched, and every sentence in the answer must cite a fact or the answer is "I don't know". Forget is physical: the person's rows are erased, their name is stripped from other quotes and from the stored turns, then the system probes itself and scans the whole database to prove the name is gone. The model only extracts and phrases. Code decides what is stored, what is recalled and what is deleted.

## Walk-through order: one failure, one mechanism

1. Deletion that removes everything learnt from it. Facts table before and after a forget; the name is gone from other facts' quotes too. Audit line: facts 0, turns 0, entities 0, summary clean. Summaries are rendered from facts, never stored.
2. "I don't know" about things never mentioned. Ask about an unknown sister. The role resolves to nobody, so no answer call is made. Closed world is a database check, not a prompt line.
3. When to bring something up. Dinner suggestion shows the allergy; weather does not. Topics are adjacent one hop; cap twelve facts.
4. Time. "Where did I live when I got the dog": the anchor fact gives a session, facts are read as of that session. "Before", "now", "two moves ago" are one query with a different cutoff.
5. Poison. Paste an instruction with an account number: fact count unchanged, stored turn has the paragraph replaced. Pasted text, headers, fences and instruction-shaped sentences never reach the extractor or the transcript.
6. The boundary. Model owns language, code owns invariants: quote in text, object in quote, unknown names abstain, deleted names appear nowhere. A model mistake is fixed with a sharper question to the model, not a rule in code.
7. Numbers. Harness three runs, zero leaks, cost per run, the scale run.

## Likely questions

- Why not a vector store? Facts are few and short; the problem is deciding what to show, not finding it. Vector search fetches the allergy for the weather question.
- Why SQLite? One file per user, transactions, and one query scans every text column for the deletion proof.
- Extractor misses a breakup? The fact stays open: a stale fact, not a leak. Code only closes, never creates.
- Forget a predicate? Erase those facts, redact their source turns, same audit.
- "My ex" after a breakup? The closed partner fact marks the person former partner; "ex" maps to that role.
- Two people called Priya? Ambiguity returns no action, because erasing the wrong person is worse than asking.
- Where is the LLM? Extract per session, classify per question, answer per question. None can write to the database.
- Cost? Under a cent per question on the cheap model, a few cents on Sonnet; the whole hidden test under a dollar.

## Finals demo, five minutes

Ingest live, show the fact count. One time-travel question. The unknown sister. Forget the ex, show the audit, ask sideways. Paste the poison. Show the cost line. Stop at 4:30.

## Day shape from the ticket

Doors 09:00. Kickoff 09:45 with a twist announced. Repo created after 10:15. Lunch 13:00 with a mentor scope review. Code freeze 17:00: repo, README, 2-minute video. Record the video at 16:30. Finals 18:15, ten builders, five minutes each.
