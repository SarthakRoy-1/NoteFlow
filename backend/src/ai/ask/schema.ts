import { z } from 'zod';

export const ANSWER_MAX = 4000;

/**
 * What the model must return for Ask AI. Deliberately minimal: there is NO field for source notes,
 * because the backend decides which notes were used (the ones it retrieved). Any extra field a
 * model adds (for example invented note ids) is dropped by parsing and never read.
 */
export const rawAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(ANSWER_MAX),
  /** false when the supplied notes do not contain what is needed to answer. */
  answerable: z.boolean(),
});

export type RawAnswer = z.infer<typeof rawAnswerSchema>;

/** JSON Schema sent to the provider. Kept in sync with the Zod schema above (see tests). */
export const answerJsonSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    answerable: { type: 'boolean' },
  },
  required: ['answer', 'answerable'],
} as const;
