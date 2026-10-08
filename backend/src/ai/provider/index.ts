import type { Env } from '../../config/env.js';
import { GeminiProvider } from './gemini.js';
import { AIProviderError, type AIProvider } from './types.js';

export type { AIProvider, AIErrorKind, StructuredRequest } from './types.js';
export { AIProviderError } from './types.js';

/** Used when no key/model is configured: the app still runs and reports a clear error per request. */
class UnconfiguredProvider implements AIProvider {
  async generateStructured(): Promise<string> {
    throw new AIProviderError('not_configured', 'AI provider is not configured');
  }
}

export function createAIProvider(env: Env): AIProvider {
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) return new UnconfiguredProvider();
  return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
}
