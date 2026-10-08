import { DateTime } from 'luxon';
import { z } from 'zod';

/**
 * A due date typed by the user, in THEIR timezone: a calendar date and an optional time.
 * (`null` clears the due date.) The server converts it to a UTC instant; the browser never
 * sends instants, so the date the user typed is the date they get. Shared by todos and reminders.
 */
export const dueInputSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-09.'),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 17:30.')
      .nullish(),
  })
  .strict()
  .nullable();

export type DueInput = NonNullable<z.infer<typeof dueInputSchema>>;

export interface ResolvedDue {
  dueAt: Date | null;
  dueHasTime: boolean;
}

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Convert the user's typed due date into a stored instant, in their timezone (DST-aware via Luxon).
 * With a time: that exact local time. Date only: no time is invented; the instant is the start
 * (reminders: alert at the start of the day) or end (todos: due by the end of the day) of that local
 * day, and dueHasTime is false. Returns null for impossible or out-of-range dates.
 */
export function resolveDueInput(
  input: DueInput,
  timezone: string,
  dateOnlyAnchor: 'start' | 'end',
): ResolvedDue | null {
  const hasTime = Boolean(input.time);
  const local = DateTime.fromISO(hasTime ? `${input.date}T${input.time}` : input.date, {
    zone: timezone,
  });
  if (!local.isValid || local.year < MIN_YEAR || local.year > MAX_YEAR) return null;
  if (hasTime) return { dueAt: local.toUTC().toJSDate(), dueHasTime: true };
  const day = dateOnlyAnchor === 'end' ? local.endOf('day') : local.startOf('day');
  return { dueAt: day.toUTC().toJSDate(), dueHasTime: false };
}
