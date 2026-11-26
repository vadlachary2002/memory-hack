// ask: classify -> closed-world select -> cited answer. Abstentions make no answer call.

import type { CallsRepo } from '../db/calls.repo.js';
import type { EntitiesRepo } from '../db/entities.repo.js';
import type { FactsRepo } from '../db/facts.repo.js';
import type { TurnsRepo } from '../db/turns.repo.js';
import type { LlmClient } from '../llm/client.js';
import { asksAboutPast } from '../roles.js';
import { trace } from '../trace.js';
import type { Answer } from '../types.js';
import { answer, NO_INFO, UNKNOWN } from './answer.js';
import { classify } from './classify.js';
import { derivationRules } from './rules.js';
import { select } from './select.js';

export type AskRepos = { facts: FactsRepo; entities: EntitiesRepo; turns: TurnsRepo; calls: CallsRepo };

export type AskOptions = { asOf?: number };

export async function ask(repos: AskRepos, client: LlmClient, question: string, opts: AskOptions = {}): Promise<Answer> {
  const sessionIdx = opts.asOf ?? repos.turns.latestSession();
  const { classification, usage: classifyUsage } = await classify(client, question);
  let cost = repos.calls.record('classify', classifyUsage, sessionIdx);

  trace('classify', { domains: classification.domains, names: classification.names, roles: classification.roles, anchor: classification.timeAnchor?.object ?? '-' });

  const selection = select(repos, classification, { asOf: opts.asOf, past: asksAboutPast(question) });
  const base = { domains: classification.domains, candidates: selection.candidates.map((fact) => fact.id), asOf: selection.asOf };
  trace('select', { asOf: selection.asOf ?? '-', entities: selection.entityIds, candidates: base.candidates, abstain: selection.abstain ?? '-' });
  if (selection.abstain !== undefined) return { ...base, text: UNKNOWN, cited: [], abstained: true, cost };
  if (selection.candidates.length === 0) return { ...base, text: NO_INFO, cited: [], abstained: true, cost };

  const nameOf = (id: number): string => repos.entities.nameOf(id);
  const rules = derivationRules(repos.facts, repos.entities.ensureUser(), classification.domains, selection.asOf);
  const generated = await answer(client, question, selection.candidates, nameOf, rules, selection.asOf);
  cost += repos.calls.record('answer', generated.usage, sessionIdx);
  trace('answer', { cited: generated.cited, rules: rules.length, cost });
  return { ...base, text: generated.text, cited: generated.cited, abstained: false, cost };
}
