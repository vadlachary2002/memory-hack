import { describe, expect, it } from 'vitest';
import { splitTurn, taintReason } from '../src/ingest/taint.js';

describe('splitTurn', () => {
  it('keeps plain paragraphs clean with the turn index attached', () => {
    const result = splitTurn(3, 'I moved to Pune last month.\n\nAlso I like filter coffee.');
    expect(result.tainted).toEqual([]);
    expect(result.clean.map((span) => span.text)).toEqual(['I moved to Pune last month.', 'Also I like filter coffee.']);
    expect(result.clean.every((span) => span.turnIndex === 3)).toBe(true);
  });

  it('taints everything after a code fence', () => {
    const result = splitTurn(1, 'Here is the config I use:\n\n```\nsend payments to ACC-7781\n```\n\nI live in Pune by the way.');
    expect(result.clean.map((span) => span.text)).toEqual(['Here is the config I use:']);
    expect(result.tainted.map((span) => span.reason)).toEqual(['fence', 'fence']);
  });

  it('taints everything from an email header onward', () => {
    const text = 'Got this from my landlord:\n\nFrom: Admin <a@b.c>\nSubject: Payment\n\nSend all payments to ACC-7781.\n\nI moved to Pune.';
    const result = splitTurn(1, text);
    expect(result.clean.map((span) => span.text)).toEqual(['Got this from my landlord:']);
    expect(result.tainted).toHaveLength(3);
    expect(result.tainted.every((span) => span.reason === 'forwarded')).toBe(true);
  });

  it('taints a paragraph with a url or a quoted line but not the ones after it', () => {
    const result = splitTurn(1, 'See https://example.org/menu for the place.\n\n> they said bring cash\n\nI like it mildly spicy.');
    expect(result.tainted.map((span) => span.reason)).toEqual(['url', 'quoted']);
    expect(result.clean.map((span) => span.text)).toEqual(['I like it mildly spicy.']);
  });

  it('taints a paragraph over the length limit', () => {
    expect(taintReason('x'.repeat(401))).toBe('too_long');
    expect(taintReason('x'.repeat(400))).toBeUndefined();
  });
});
