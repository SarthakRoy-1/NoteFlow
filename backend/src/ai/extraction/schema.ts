import { z } from 'zod';

/**
 * What the model must return. Empty `items` means "nothing actionable".
 * Dates are expressed as the user's LOCAL wall-clock time (no offset); the backend converts them
 * to UTC using the user's IANA timezone, so the model never has to do timezone arithmetic.
 */
export const DUE_KINDS = ['none', 'date', 'datetime', 'relative'] as const;
export const RECURRENCE_KINDS = ['none', 'daily', 'weekdays', 'weekly'] as const;

export const rawItemSchema = z.object({
  kind: z.enum(['todo', 'reminder']),
  /** Todo title or reminder content, short and imperative. */
  text: z.string().min(1).max(500),
  /** Reminders only: a person named in the note. */
  person: z.string().max(200).nullable(),
  /** Verbatim quote from the note that supports this item. */
  evidence: z.string().min(1).max(1000),
  due_kind: z.enum(DUE_KINDS),
  /** Verbatim words from the note that express the date/time, e.g. "next Friday at 3 PM". */
  due_expression: z.string().max(200).nullable(),
  /** "YYYY-MM-DD" (date) or "YYYY-MM-DDTHH:mm" (datetime), user-local. */
  due_local: z.string().max(40).nullable(),
  /** For due_kind "relative": whole minutes from now (e.g. "in two hours" -> 120); otherwise 0. */
  due_relative_minutes: z.number().int().nullable(),
  // Optional so a reply without them (an older prompt, another provider) simply means "does not
  // repeat". They are only ever used after the backend has checked the quoted words (validate.ts).
  /** Reminders only: how the reminder repeats. "none" for a one-off. */
  recurrence_kind: z.enum(RECURRENCE_KINDS).nullish(),
  /** For recurrence_kind "weekly": ISO weekdays, 1 = Monday ... 7 = Sunday. Otherwise []. */
  recurrence_weekdays: z.array(z.number().int()).max(14).nullish(),
  /** Verbatim words from the note that express the repetition, e.g. "every Monday". */
  recurrence_expression: z.string().max(200).nullish(),
});

export const rawExtractionSchema = z.object({
  items: z.array(rawItemSchema).max(50),
});

export type RawItem = z.infer<typeof rawItemSchema>;
export type RawExtraction = z.infer<typeof rawExtractionSchema>;

const nullable = (type: string) => ({ type: [type, 'null'] });

/** JSON Schema sent to the provider. Kept in sync with the Zod schema above (see tests). */
export const extractionJsonSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['todo', 'reminder'] },
          text: { type: 'string' },
          person: nullable('string'),
          evidence: { type: 'string' },
          due_kind: { type: 'string', enum: [...DUE_KINDS] },
          due_expression: nullable('string'),
          due_local: nullable('string'),
          // Plain integer (0 = not relative): Gemini's schema mode is picky about nullable numerics.
          due_relative_minutes: { type: 'integer' },
          recurrence_kind: { type: 'string', enum: [...RECURRENCE_KINDS] },
          recurrence_weekdays: { type: 'array', items: { type: 'integer' } },
          recurrence_expression: nullable('string'),
        },
        required: [
          'kind',
          'text',
          'person',
          'evidence',
          'due_kind',
          'due_expression',
          'due_local',
          'due_relative_minutes',
          'recurrence_kind',
          'recurrence_weekdays',
          'recurrence_expression',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;
