import { describe, expect, it } from 'vitest';
import { ADJACENCY, DOMAINS, PREDICATES, PREDICATE_NAMES, isDomain, isPredicate, reachableDomains, tierOf } from '../src/vocab.js';

describe('adjacency', () => {
  it('never lets a weather question reach health facts', () => {
    const reach = reachableDomains(['weather']);
    expect(reach).toContain('weather');
    expect(reach).toContain('location');
    expect(reach).not.toContain('health');
    expect(reach).not.toContain('food');
  });

  it('lets food and dining questions reach health facts', () => {
    expect(reachableDomains(['food'])).toContain('health');
    expect(reachableDomains(['dining'])).toContain('health');
  });

  it('includes every question domain itself and dedupes', () => {
    const reach = reachableDomains(['food', 'dining']);
    expect(new Set(reach).size).toBe(reach.length);
    expect(reach).toContain('food');
    expect(reach).toContain('dining');
  });

  it('only references known domains', () => {
    for (const domain of DOMAINS) {
      for (const neighbour of ADJACENCY[domain]) expect(isDomain(neighbour)).toBe(true);
    }
  });
});

describe('predicates', () => {
  it('flags are consistent', () => {
    for (const name of PREDICATE_NAMES) {
      const spec = PREDICATES[name];
      expect(spec.durable).toBe(!spec.ephemeral);
      if (spec.ephemeral) expect(spec.functional).toBe(false);
      for (const domain of spec.domains) expect(isDomain(domain)).toBe(true);
    }
  });

  it('routes ephemeral predicates to scratch', () => {
    expect(tierOf('searched_for')).toBe('scratch');
    expect(tierOf('started_project')).toBe('scratch');
    expect(tierOf('lives_in')).toBe('durable');
  });

  it('has no predicate that expresses an instruction', () => {
    for (const name of PREDICATE_NAMES) expect(name).not.toMatch(/send|pay|transfer|remember|instruct/);
    expect(isPredicate('send_payment')).toBe(false);
  });
});
