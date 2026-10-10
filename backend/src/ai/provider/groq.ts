import { logger } from '../../lib/logger.js';
import { AIProviderError, type AIProvider, type StructuredRequest } from './types.js';

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export interface GroqOptions {
  apiKey: string;
  model?: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Total attempts (first try + retries). Retries only for 5xx and network errors. */
  maxAttempts?: number;
  retryDelayMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GroqResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
}

type Schema = Record<string, unknown>;

/**
 * Groq's strict structured outputs need every property listed in `required` and
 * `additionalProperties: false` on every object. Our schemas are written for Gemini, so adapt a
 * copy here; the backend still validates the reply with Zod regardless.
 */
export function toStrictSchema(schema: Schema): Schema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const out: Schema = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value);
    const props = out.properties;
    if (props && typeof props === 'object') {
      out.required = Object.keys(props);
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(schema) as Schema;
}

/** Groq's OpenAI-compatible chat completions API with JSON-schema constrained output. */
export class GroqProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GroqOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_GROQ_MODEL;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateStructured(request: StructuredRequest): Promise<string> {
    let lastError: AIProviderError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.callOnce(request);
      } catch (err) {
        if (!(err instanceof AIProviderError)) throw err;
        lastError = err;
        // Retry only server errors (5xx) and network failures. Never 429 (a retry spends more
        // quota), other 4xx, or timeouts.
        const retryable =
          err.kind === 'unavailable' && (err.httpStatus === undefined || err.httpStatus >= 500);
        logger.warn('Groq call failed', { kind: err.kind, status: err.httpStatus, attempt });
        if (!retryable || attempt === this.maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
    throw lastError ?? new AIProviderError('unavailable', 'Groq call failed');
  }

  private async callOnce(request: StructuredRequest): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        // The key travels in a header only, so it cannot leak through URL logging.
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          temperature: 0,
          // Reasoning tokens count toward this limit, so keep reasoning short and the limit roomy.
          max_completion_tokens: 3000,
          reasoning_effort: 'low',
          include_reasoning: false,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'noteflow_response',
              strict: true,
              schema: toStrictSchema(request.jsonSchema),
            },
          },
        }),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AIProviderError('timeout', 'Groq request timed out');
      }
      throw new AIProviderError('unavailable', 'Could not reach Groq');
    }

    if (!res.ok) throw await this.errorForStatus(res);

    let body: GroqResponse;
    try {
      body = (await res.json()) as GroqResponse;
    } catch {
      throw new AIProviderError('bad_response', 'Groq returned a non-JSON body', res.status);
    }

    const choice = body.choices?.[0];
    if (!choice) throw new AIProviderError('bad_response', 'Groq returned no choices');
    if (choice.finish_reason === 'content_filter') {
      throw new AIProviderError('blocked', 'Groq blocked the content');
    }
    // 'length' means the reply was cut off, so the JSON is incomplete.
    if (choice.finish_reason && choice.finish_reason !== 'stop') {
      throw new AIProviderError('bad_response', `Groq finished with ${choice.finish_reason}`);
    }
    const text = choice.message?.content ?? '';
    if (!text.trim()) throw new AIProviderError('bad_response', 'Groq returned empty text');
    return text;
  }

  private async errorForStatus(res: Response): Promise<AIProviderError> {
    const status = res.status;
    if (status === 429) {
      // Groq reports the daily request allowance in x-ratelimit-remaining-requests; a per-minute
      // limit leaves it above zero. The body also names "per day" limits.
      const remaining = res.headers.get('x-ratelimit-remaining-requests');
      const detail = await res.text().catch(() => '');
      const daily = remaining === '0' || /per day|tokens per day|\bTPD\b|\bRPD\b/i.test(detail);
      return new AIProviderError(daily ? 'quota_exhausted' : 'rate_limited', 'Groq quota', status);
    }
    if (status === 401 || status === 403 || status === 404) {
      return new AIProviderError('not_configured', 'Groq rejected the key or model', status);
    }
    // 400: the model's output did not satisfy the schema (or a request we built was refused).
    if (status === 400 || status === 413 || status === 422) {
      return new AIProviderError('bad_response', 'Groq could not produce a valid reply', status);
    }
    return new AIProviderError('unavailable', 'Groq returned an error', status);
  }
}
