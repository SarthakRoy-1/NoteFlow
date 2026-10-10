import type { Env } from '../../config/env.js';
import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
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
  const geminiReady = Boolean(env.GEMINI_API_KEY && env.GEMINI_MODEL);
  const choice =
    env.AI_PROVIDER ?? (geminiReady ? 'gemini' : env.GROQ_API_KEY ? 'groq' : undefined);
  if (choice === 'groq' && env.GROQ_API_KEY) {
    return new GroqProvider({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL });
  }
  if (choice === 'gemini' && env.GEMINI_API_KEY && env.GEMINI_MODEL) {
    return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  }
  return new UnconfiguredProvider();
}
