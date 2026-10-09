import { AIProviderError, type AIProvider } from '../provider/index.js';
import { buildTimeContext } from './dates.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { extractionJsonSchema, rawExtractionSchema } from './schema.js';
import { validateExtraction, type ExtractedItem } from './validate.js';

export type ExtractionFailureCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_QUOTA_EXHAUSTED'
  | 'AI_UNAVAILABLE'
  | 'AI_BLOCKED'
  | 'AI_BAD_OUTPUT';

/** Failure of the extraction step. `userMessage` is safe to store and show: no secrets, no raw output. */
export class ExtractionError extends Error {
  constructor(
    public readonly code: ExtractionFailureCode,
    public readonly userMessage: string,
  ) {
    super(code);
    this.name = 'ExtractionError';
  }
}

const SAVED = 'Your note was saved.';

export function toExtractionError(err: unknown): ExtractionError {
  if (err instanceof ExtractionError) return err;
  if (err instanceof AIProviderError) {
    switch (err.kind) {
      case 'not_configured':
        return new ExtractionError(
          'AI_NOT_CONFIGURED',
          `${SAVED} AI analysis is not set up on this server, so no todos or reminders were created.`,
        );
      case 'timeout':
        return new ExtractionError(
          'AI_TIMEOUT',
          `${SAVED} The AI service took too long to respond. You can retry the analysis.`,
        );
      case 'rate_limited':
        return new ExtractionError(
          'AI_RATE_LIMITED',
          `${SAVED} The AI service is busy right now. Please retry the analysis in a minute.`,
        );
      case 'quota_exhausted':
        return new ExtractionError(
          'AI_QUOTA_EXHAUSTED',
          `${SAVED} The AI service's usage limit has been reached for now. You can retry the analysis later.`,
        );
      case 'blocked':
        return new ExtractionError(
          'AI_BLOCKED',
          `${SAVED} The AI service declined to analyse this note.`,
        );
      case 'bad_response':
        return new ExtractionError(
          'AI_BAD_OUTPUT',
          `${SAVED} The AI service returned an unusable answer. You can retry the analysis.`,
        );
      default:
        return new ExtractionError(
          'AI_UNAVAILABLE',
          `${SAVED} The AI service is unavailable right now. You can retry the analysis.`,
        );
    }
  }
  return new ExtractionError(
    'AI_UNAVAILABLE',
    `${SAVED} AI analysis failed unexpectedly. You can retry the analysis.`,
  );
}

const badOutput = () =>
  new ExtractionError(
    'AI_BAD_OUTPUT',
    `${SAVED} The AI service returned an unusable answer. You can retry the analysis.`,
  );

/** Models occasionally wrap JSON in a markdown fence even in JSON mode; strip only that. */
export function stripFence(text: string): string {
  const trimmed = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return m?.[1] ?? trimmed;
}

export interface ExtractInput {
  provider: AIProvider;
  title: string;
  content: string;
  timezone: string;
  now: Date;
}

/**
 * Provider call -> parse -> schema validation -> business validation -> normalization.
 * Throws ExtractionError for every failure; never returns unvalidated model output.
 */
export async function extractIntents(input: ExtractInput): Promise<ExtractedItem[]> {
  const { provider, title, content, timezone, now } = input;

  let rawText: string;
  try {
    rawText = await provider.generateStructured({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({
        title,
        content,
        timeContext: buildTimeContext(now, timezone),
      }),
      jsonSchema: extractionJsonSchema,
    });
  } catch (err) {
    throw toExtractionError(err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(rawText));
  } catch {
    throw badOutput();
  }

  const checked = rawExtractionSchema.safeParse(parsed);
  if (!checked.success) throw badOutput();

  return validateExtraction(checked.data, { title, content, timezone, now }).items;
}
