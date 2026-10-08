import { z } from 'zod';
import {
  dueInputSchema,
  resolveDueInput,
  type DueInput,
  type ResolvedDue,
} from '../../lib/dueInput.js';
import { notFound } from '../../lib/errors.js';

export const REMINDER_TEXT_MAX = 200;
export const REMINDER_PERSON_MAX = 80;
export const REMINDER_NOT_FOUND = 'We could not find that reminder.';

const text = z
  .string({ invalid_type_error: 'Reminder text must be text.' })
  .trim()
  .min(1, 'Reminder text cannot be empty.')
  .max(REMINDER_TEXT_MAX, `Reminder text must be at most ${REMINDER_TEXT_MAX} characters.`);

// A blank person clears it (null). The person is informational only: nobody is notified.
const person = z
  .string({ invalid_type_error: 'Person must be text.' })
  .trim()
  .max(REMINDER_PERSON_MAX, `Person must be at most ${REMINDER_PERSON_MAX} characters.`)
  .transform((v) => (v === '' ? null : v))
  .nullable();

// strict(): only these fields can be edited. user_id, source_note_id, ai_fingerprint, status,
// timestamps and any other column are rejected, never ignored.
export const updateReminderBody = z
  .object({
    text: text.optional(),
    person: person.optional(),
    due: dueInputSchema.optional(),
    /** true = "got it" (stops alerting); false = re-open. */
    acknowledged: z.boolean().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.text !== undefined ||
      b.person !== undefined ||
      b.due !== undefined ||
      b.acknowledged !== undefined,
    { message: 'Provide something to update.' },
  );

export type UpdateReminderInput = z.infer<typeof updateReminderBody>;

const uuid = z.string().uuid();

/** A malformed id can never match a reminder, so it is reported exactly like a missing one. */
export function parseReminderId(raw: unknown): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw notFound(REMINDER_NOT_FOUND);
  return parsed.data;
}

/** Reminders alert at the START of a date-only day: no clock time is ever invented for them. */
export function resolveReminderDue(input: DueInput, timezone: string): ResolvedDue | null {
  return resolveDueInput(input, timezone, 'start');
}

export type { ResolvedDue };
