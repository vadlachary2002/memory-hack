// Anthropic implementation of LlmClient. The only file that imports the SDK.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { modelFor, type Purpose } from '../config.js';
import type { LlmClient, StructuredRequest, StructuredResult, Usage } from './client.js';

const DEFAULT_MAX_TOKENS = 4096;

// Extraction and classification are mechanical; answering gets a little more thought.
const EFFORT: Record<Purpose, 'low' | 'medium'> = { extract: 'low', screen: 'low', classify: 'low', answer: 'medium' };

export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey === undefined ? {} : { apiKey });
  }

  async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = modelFor(request.purpose);
    const response = await this.client.messages.parse({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: request.user }],
      output_config: { effort: EFFORT[request.purpose], format: zodOutputFormat(request.schema) },
    });
    if (response.stop_reason === 'refusal') throw new Error(`model refused the ${request.purpose} call`);
    const value = response.parsed_output;
    if (value === null || value === undefined) throw new Error(`model returned no parseable ${request.purpose} output`);
    return { value, usage: usageOf(model, response.usage) };
  }
}

function usageOf(model: string, usage: Anthropic.Usage): Usage {
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}
