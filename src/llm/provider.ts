// Picks the provider from the model name, so Anthropic and Gemini models can be mixed per purpose:
// EXTRACT_MODEL=gemini-3-flash-preview with ANSWER_MODEL=claude-opus-5-5 is one line of .env.

import { modelFor } from '../config.js';
import { AnthropicClient } from './anthropic.js';
import type { LlmClient, StructuredRequest, StructuredResult } from './client.js';
import { GeminiClient } from './gemini.js';

export type Provider = 'anthropic' | 'gemini';

export type Env = Record<string, string | undefined>;

export function providerFor(model: string): Provider {
  return model.toLowerCase().startsWith('gemini') ? 'gemini' : 'anthropic';
}

// The key a provider needs, or the error to raise when it is missing.
export function keyFor(provider: Provider, env: Env = process.env): string | undefined {
  const name = provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function hasAnyKey(env: Env = process.env): boolean {
  return keyFor('anthropic', env) !== undefined || keyFor('gemini', env) !== undefined;
}

// Lazily builds one client per provider and routes each call by the model chosen for its purpose.
export function createClient(env: Env = process.env): LlmClient {
  const clients = new Map<Provider, LlmClient>();
  return {
    structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const provider = providerFor(modelFor(request.purpose, env));
      let client = clients.get(provider);
      if (client === undefined) {
        const key = keyFor(provider, env);
        if (key === undefined) {
          const name = provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
          return Promise.reject(new Error(`${name} is not set (needed for ${modelFor(request.purpose, env)}); put it in .env`));
        }
        client = provider === 'gemini' ? new GeminiClient(key) : new AnthropicClient(key);
        clients.set(provider, client);
      }
      return client.structured(request);
    },
  };
}
