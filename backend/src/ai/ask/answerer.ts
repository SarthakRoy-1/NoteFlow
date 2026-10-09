import { AppError } from '../../lib/errors.js';
import { stripFence } from '../extraction/extractor.js';
import { AIProviderError, type AIProvider } from '../provider/index.js';
import { buildAskPrompt, ASK_SYSTEM_PROMPT, type AskNote } from './prompt.js';
import { answerJsonSchema, rawAnswerSchema, type RawAnswer } from './schema.js';

/** User-safe error for a failed Ask AI call: no secrets, no provider internals, no raw output. */
export function toAskError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof AIProviderError) {
    switch (err.kind) {
      case 'not_configured':
        return new AppError(
          'AI_NOT_CONFIGURED',
          503,
          'Ask AI is not set up on this server yet, so your question could not be answered.',
        );
      case 'timeout':
        return new AppError(
          'AI_TIMEOUT',
          504,
          'The AI service took too long to respond. Please try again.',
        );
      case 'rate_limited':
        return new AppError(
          'AI_RATE_LIMITED',
          429,
          'The AI service is busy right now. Please try again in a minute.',
        );
      case 'quota_exhausted':
        return new AppError(
          'AI_QUOTA_EXHAUSTED',
          503,
          "The AI service's usage limit has been reached for now. Please try again later.",
        );
      case 'blocked':
        return new AppError(
          'AI_BLOCKED',
          422,
          'The AI service declined to answer this question. Try rephrasing it.',
        );
      case 'bad_response':
        return badOutput();
      default:
        return new AppError(
          'AI_UNAVAILABLE',
          502,
          'The AI service is unavailable right now. Please try again.',
        );
    }
  }
  return new AppError(
    'AI_UNAVAILABLE',
    502,
    'Your question could not be answered because of an unexpected problem. Please try again.',
  );
}

const badOutput = () =>
  new AppError(
    'AI_BAD_OUTPUT',
    502,
    'The AI service returned an unusable answer. Please try again.',
  );

export interface AnswerInput {
  provider: AIProvider;
  question: string;
  notes: AskNote[];
}

/**
 * Provider call -> parse -> schema validation. Throws AppError for every failure and never returns
 * unvalidated model output. Source notes are NOT part of the result: the caller owns that.
 */
export async function answerQuestion(input: AnswerInput): Promise<RawAnswer> {
  const { provider, question, notes } = input;

  let rawText: string;
  try {
    rawText = await provider.generateStructured({
      system: ASK_SYSTEM_PROMPT,
      user: buildAskPrompt({ question, notes }),
      jsonSchema: answerJsonSchema,
    });
  } catch (err) {
    throw toAskError(err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(rawText));
  } catch {
    throw badOutput();
  }
  const checked = rawAnswerSchema.safeParse(parsed);
  if (!checked.success) throw badOutput();
  return checked.data;
}
