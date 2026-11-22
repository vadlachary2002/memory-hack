// Derivation rules handed to the answer call. Nothing derived is ever stored.

import type { FactsRepo } from '../db/facts.repo.js';
import type { Domain } from '../vocab.js';

const EXPENSE_DOMAINS: readonly Domain[] = ['work', 'finance'];

export function derivationRules(facts: FactsRepo, userId: number, domains: readonly Domain[], asOf?: number): string[] {
  const rules: string[] = [];
  if (!domains.some((domain) => EXPENSE_DOMAINS.includes(domain))) return rules;
  const explicit = asOf === undefined ? facts.currentFor(userId, 'expense_approver') : facts.validAt(userId, 'expense_approver', asOf);
  if (explicit.length > 0) {
    rules.push('An explicit "expenses approved by" fact names the approver; it wins over any manager fact.');
  } else {
    rules.push(
      'Expenses are approved by the current manager. If asked who approves expenses and no fact says otherwise, answer with the current "reports to" fact and cite it.',
    );
  }
  return rules;
}
