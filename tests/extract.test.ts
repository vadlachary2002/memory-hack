import { describe, expect, it } from 'vitest';
import { extractSession, validateCandidates, type Candidate } from '../src/ingest/extract.js';
import type { Span } from '../src/ingest/taint.js';
import { FakeClient } from '../src/llm/fake.js';

const SPANS: Span[] = [
  { turnIndex: 1, text: 'Finally done with the move, I moved to Pune last month for the new job.' },
  { turnIndex: 3, text: 'Switched to an iPhone finally, the Android was dying.' },
];

function candidate(overrides: Partial<Candidate> & Pick<Candidate, 'predicate' | 'object' | 'quote' | 'turnIndex'>): Candidate {
  return { about: 'me', attrKey: null, objectIsEntity: false, entityType: null, aliases: [], domains: [], ended: false, ...overrides };
}

describe('validateCandidates', () => {
  it('drops a paraphrased object', () => {
    const { accepted, rejected } = validateCandidates(
      [candidate({ turnIndex: 1, about: 'me', predicate: 'lives_in', object: 'Pune city', quote: 'I moved to Pune last month' })],
      SPANS,
    );
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ reason: 'object_not_in_quote', candidate: 'lives_in Pune city' }]);
  });

  it('drops a quote that is not in the clean text of its turn', () => {
    const { rejected } = validateCandidates(
      [
        candidate({ turnIndex: 1, about: 'me', predicate: 'lives_in', object: 'Pune', quote: 'I live in Pune now' }),
        candidate({ turnIndex: 9, about: 'me', predicate: 'lives_in', object: 'Pune', quote: 'I moved to Pune last month' }),
      ],
      SPANS,
    );
    expect(rejected.map((item) => item.reason)).toEqual(['quote_not_in_turn', 'quote_not_in_turn']);
  });

  it('keeps exact quotes, ignoring whitespace differences, and keeps attributes', () => {
    const { accepted, rejected } = validateCandidates(
      [
        candidate({ turnIndex: 1, about: 'me', predicate: 'lives_in', object: 'Pune', quote: 'I moved  to Pune last month' }),
        candidate({ turnIndex: 3, about: 'me', predicate: 'attribute', attrKey: 'phone', object: 'iPhone', quote: 'Switched to an iPhone' }),
      ],
      SPANS,
    );
    expect(rejected).toEqual([]);
    expect(accepted.map((item) => item.object)).toEqual(['Pune', 'iPhone']);
  });

  it('drops empty objects or quotes', () => {
    const { rejected } = validateCandidates([candidate({ turnIndex: 1, about: 'me', predicate: 'lives_in', object: ' ', quote: 'I moved to Pune' })], SPANS);
    expect(rejected[0]?.reason).toBe('empty');
  });
});

describe('extractSession', () => {
  it('sends clean spans labelled by turn and validates what comes back', async () => {
    const client = new FakeClient().enqueue('extract', {
      facts: [
        candidate({ turnIndex: 1, about: 'me', predicate: 'lives_in', object: 'Pune', quote: 'I moved to Pune last month', domains: ['location'] }),
        candidate({ turnIndex: 3, about: 'me', predicate: 'attribute', attrKey: 'phone', object: 'iPhone 15', quote: 'Switched to an iPhone' }),
      ],
    });
    const result = await extractSession(client, SPANS);
    expect(client.seen[0]?.user).toContain('turn 1: Finally done');
    expect(client.seen[0]?.user).toContain('turn 3: Switched');
    expect(result.accepted.map((item) => item.object)).toEqual(['Pune']);
    expect(result.rejected).toEqual([{ reason: 'object_not_in_quote', candidate: 'attribute[phone] iPhone 15' }]);
    expect(result.usage.model).toBe('fake');
  });
});
