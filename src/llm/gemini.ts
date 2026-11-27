// Gemini implementation of LlmClient. The only file that imports the Google SDK.

import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { z, type ZodType } from 'zod';
import { modelFor } from '../config.js';
import type { LlmClient, StructuredRequest, StructuredResult, Usage } from './client.js';

const DEFAULT_MAX_TOKENS = 4096;

export class GeminiClient implements LlmClient {
  private readonly client: GoogleGenAI;

  // Preview models are served on v1beta; the SDK's default version returns 404 for them.
  constructor(apiKey?: string) {
    this.client = new GoogleGenAI({ ...(apiKey === undefined ? {} : { apiKey }), httpOptions: { apiVersion: 'v1beta' } });
  }

  // Model ids the key can use with generateContent, for picking names that exist today.
  async listModels(): Promise<string[]> {
    const names: string[] = [];
    const pager = await this.client.models.list();
    for await (const model of pager) {
      const actions = model.supportedActions ?? [];
      if (actions.length === 0 || actions.includes('generateContent')) names.push((model.name ?? '').replace(/^models\//, ''));
    }
    return names.filter((name) => name !== '').sort();
  }

  async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = modelFor(request.purpose);
    const response = await this.client.models.generateContent({
      model,
      contents: request.user,
      config: {
        systemInstruction: request.system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchemaFor(request.schema),
        maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
    });
    const text = response.text;
    if (text === undefined || text.trim() === '') throw new Error(`model returned no ${request.purpose} output`);
    const value = request.schema.parse(JSON.parse(text));
    return { value, usage: usageOf(model, response) };
  }
}

// Gemini takes plain JSON Schema; zod 4 emits it directly. The "$schema" marker is dropped.
export function jsonSchemaFor(schema: ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function usageOf(model: string, response: GenerateContentResponse): Usage {
  const meta = response.usageMetadata;
  const cached = meta?.cachedContentTokenCount ?? 0;
  return {
    model,
    inputTokens: Math.max(0, (meta?.promptTokenCount ?? 0) - cached),
    outputTokens: meta?.candidatesTokenCount ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}
