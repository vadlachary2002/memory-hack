// The only contract the rest of the system has with a model provider.

import type { ZodType } from 'zod';
import type { Purpose } from '../config.js';

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type StructuredRequest<T> = {
  purpose: Purpose;
  schema: ZodType<T>;
  // Fixed instructions; cached by the provider when it can.
  system: string;
  // Volatile content for this call.
  user: string;
  maxTokens?: number;
};

export type StructuredResult<T> = { value: T; usage: Usage };

export interface LlmClient {
  structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
