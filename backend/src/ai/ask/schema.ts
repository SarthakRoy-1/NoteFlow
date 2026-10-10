import { z } from 'zod';

export const ANSWER_MAX = 4000;

/**
 * What the model must return for Ask AI. There are NO note ids: the model only says which of the
 * numbered notes it was given supported the answer (`used_notes`, 1-based positions). The backend
 * maps those positions onto the notes it retrieved itself, ignores anything out of range, and falls
 * back to all retrieved notes when the field is missing or unusable. Any other field a model adds
 * (for example invented note ids) is dropped by parsing and never read.
 */
export const rawAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(ANSWER_MAX),
  /** false when the supplied notes do not contain what is needed to answer. */
  answerable: z.boolean(),
  /** Positions (1-based) of the supplied notes the answer relies on. */
  used_notes: z.array(z.number().int()).max(50).default([]),
});

export type RawAnswer = z.infer<typeof rawAnswerSchema>;

/** JSON Schema sent to the provider. Kept in sync with the Zod schema above (see tests). */
export const answerJsonSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    answerable: { type: 'boolean' },
    used_notes: { type: 'array', items: { type: 'integer' } },
  },
  required: ['answer', 'answerable', 'used_notes'],
} as const;
