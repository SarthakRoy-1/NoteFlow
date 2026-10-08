/**
 * The only AI surface the rest of the application depends on. Vendor details (HTTP shape, auth,
 * model names, safety filters) stay inside a concrete provider such as GeminiProvider.
 */
export type AIErrorKind =
  | 'not_configured' // no key/model, or the provider rejected our credentials/model name
  | 'timeout'
  | 'rate_limited' // short-term limit: retrying in a minute may work
  | 'quota_exhausted' // daily/plan quota used up: retrying soon will not help
  | 'unavailable' // network failure or provider-side error
  | 'blocked' // provider refused to process the content
  | 'bad_response'; // reply was empty, truncated or not parseable as a reply at all

export class AIProviderError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export interface StructuredRequest {
  /** Fixed instructions written by us. Never contains user content. */
  system: string;
  /** Per-request content, including any untrusted user text (clearly delimited by the caller). */
  user: string;
  /** JSON Schema the reply must follow. */
  jsonSchema: Record<string, unknown>;
}

export interface AIProvider {
  /** Returns the model's raw JSON text. Callers must parse and validate it; it is not trusted. */
  generateStructured(request: StructuredRequest): Promise<string>;
}
