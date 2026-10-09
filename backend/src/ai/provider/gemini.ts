import { logger } from '../../lib/logger.js';
import { AIProviderError, type AIProvider, type StructuredRequest } from './types.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Per-attempt timeout (default 12s: two attempts plus the retry delay stay under ~30s). */
  timeoutMs?: number;
  /** Total attempts (first try + retries). Retries only for 429, 5xx and network errors. */
  maxAttempts?: number;
  retryDelayMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
  promptFeedback?: { blockReason?: string };
}

/** Gemini REST implementation of AIProvider (generateContent with JSON-schema constrained output). */
export class GeminiProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 12_000;
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
        // Retry only server errors (5xx) and network failures. Never 429 (a retry just spends more
        // quota), other 4xx, or timeouts.
        const retryable =
          err.kind === 'unavailable' && (err.httpStatus === undefined || err.httpStatus >= 500);
        logger.warn('Gemini call failed', { kind: err.kind, status: err.httpStatus, attempt });
        if (!retryable || attempt === this.maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
    throw lastError ?? new AIProviderError('unavailable', 'Gemini call failed');
  }

  private async callOnce(request: StructuredRequest): Promise<string> {
    // The key travels in a header (never in the URL) so it cannot leak through URL logging.
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            responseJsonSchema: request.jsonSchema,
          },
        }),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AIProviderError('timeout', 'Gemini request timed out');
      }
      throw new AIProviderError('unavailable', 'Could not reach Gemini');
    }

    if (!res.ok) throw await this.errorForStatus(res);

    let body: GeminiResponse;
    try {
      body = (await res.json()) as GeminiResponse;
    } catch {
      throw new AIProviderError('bad_response', 'Gemini returned a non-JSON body', res.status);
    }

    if (body.promptFeedback?.blockReason) {
      throw new AIProviderError('blocked', 'Gemini blocked the prompt');
    }
    const candidate = body.candidates?.[0];
    if (!candidate) throw new AIProviderError('bad_response', 'Gemini returned no candidates');
    const reason = candidate.finishReason;
    if (reason && reason !== 'STOP') {
      const blocked = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'];
      throw new AIProviderError(
        blocked.includes(reason) ? 'blocked' : 'bad_response',
        `Gemini finished with ${reason}`,
      );
    }
    // Skip "thought" parts (reasoning summaries): only the answer text may be parsed as JSON.
    const text = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    if (!text.trim()) throw new AIProviderError('bad_response', 'Gemini returned empty text');
    return text;
  }

  private async errorForStatus(res: Response): Promise<AIProviderError> {
    const status = res.status;
    if (status === 429) {
      // Gemini names the exhausted quota in the error body, e.g. "...PerDay...".
      const detail = await res.text().catch(() => '');
      const daily = /PerDay|per day/i.test(detail);
      return new AIProviderError(
        daily ? 'quota_exhausted' : 'rate_limited',
        'Gemini quota',
        status,
      );
    }
    if (status === 401 || status === 403 || status === 404) {
      return new AIProviderError('not_configured', 'Gemini rejected the key or model', status);
    }
    return new AIProviderError('unavailable', 'Gemini returned an error', status);
  }
}
