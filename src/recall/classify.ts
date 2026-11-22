// One structured call: question -> domains, names, roles, time anchor. Closed enums only.

import { z } from 'zod';
import type { LlmClient, Usage } from '../llm/client.js';
import { CLASSIFY_SYSTEM } from '../llm/prompts.js';
import { DOMAINS, PREDICATE_NAMES } from '../vocab.js';

export const ClassificationSchema = z.object({
  domains: z.array(z.enum(DOMAINS)),
  // Proper names of people or pets the question refers to.
  names: z.array(z.string()),
  // Relationship words for other people: sister, manager, ex.
  roles: z.array(z.string()),
  // "when I got Bruno" -> { predicate: adopted_pet, object: "Bruno" }. Used from step 5.
  timeAnchor: z.object({ predicate: z.enum(PREDICATE_NAMES), object: z.string() }).nullable(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

export async function classify(client: LlmClient, question: string): Promise<{ classification: Classification; usage: Usage }> {
  const { value, usage } = await client.structured({
    purpose: 'classify',
    schema: ClassificationSchema,
    system: CLASSIFY_SYSTEM,
    user: question,
    maxTokens: 512,
  });
  const domains = value.domains.length === 0 ? (['general'] as Classification['domains']) : value.domains;
  return { classification: { ...value, domains }, usage };
}
