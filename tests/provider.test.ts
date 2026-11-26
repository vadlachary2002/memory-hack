import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defaultModel, modelFor, priceFor } from '../src/config.js';
import { jsonSchemaFor } from '../src/llm/gemini.js';
import { createClient, hasAnyKey, keyFor, providerFor } from '../src/llm/provider.js';
import { ClassificationSchema } from '../src/recall/classify.js';
import { ExtractionSchema } from '../src/ingest/extract.js';

describe('provider selection', () => {
  it('routes by model name', () => {
    expect(providerFor('claude-opus-5-5')).toBe('anthropic');
    expect(providerFor('gemini-3-flash-preview')).toBe('gemini');
    expect(providerFor('Gemini-3.1-pro-preview')).toBe('gemini');
  });

  it('defaults to Anthropic when its key exists, Gemini when only that key exists', () => {
    expect(defaultModel({ ANTHROPIC_API_KEY: 'a' })).toBe('claude-opus-5-5');
    expect(defaultModel({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toBe('claude-opus-5-5');
    expect(defaultModel({ GEMINI_API_KEY: 'g' })).toBe('gemini-3-flash-preview');
    expect(defaultModel({})).toBe('claude-opus-5-5');
  });

  it('lets each purpose pick its own model across providers', () => {
    const env = { GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', EXTRACT_MODEL: 'gemini-3-flash-preview' };
    expect(modelFor('extract', env)).toBe('gemini-3-flash-preview');
    expect(modelFor('answer', env)).toBe('claude-opus-5-5');
    expect(modelFor('answer', { ...env, MODEL: 'claude-haiku-5-5' })).toBe('claude-haiku-5-5');
  });

  it('knows the keys and prices', () => {
    expect(keyFor('gemini', { GEMINI_API_KEY: 'g' })).toBe('g');
    expect(keyFor('anthropic', { GEMINI_API_KEY: 'g' })).toBeUndefined();
    expect(hasAnyKey({})).toBe(false);
    expect(priceFor('gemini-3-flash-preview').input).toBe(0.5);
    expect(priceFor('gemini-9-unknown').output).toBe(12);
    expect(priceFor('claude-unknown').output).toBe(20);
  });

  it('fails with a clear message when the routed provider has no key', async () => {
    const client = createClient({ GEMINI_API_KEY: 'g', MODEL: 'claude-opus-5-5' });
    await expect(client.structured({ purpose: 'classify', schema: z.object({}), system: '', user: '' })).rejects.toThrow(
      'ANTHROPIC_API_KEY is not set',
    );
  });
});

describe('Gemini JSON schema', () => {
  it('converts the real prompt schemas without the $schema marker', () => {
    for (const schema of [ClassificationSchema, ExtractionSchema]) {
      const json = jsonSchemaFor(schema);
      expect(json.$schema).toBeUndefined();
      expect(json.type).toBe('object');
      expect(json.properties).toBeDefined();
    }
  });
});
