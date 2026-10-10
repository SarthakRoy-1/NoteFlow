import { DateTime } from 'luxon';
import { z } from 'zod';

/**
 * A repeating schedule: the ISO weekdays (1 = Monday ... 7 = Sunday) it falls on, and an optional
 * wall-clock time ("HH:mm") in the owner's timezone. No time = the start of each such day.
 * Occurrences are computed from the wall clock in the user's zone, so "9:00 every Monday" stays at
 * 9:00 local across daylight-saving changes.
 */
export interface Recurrence {
  days: number[];
  time: string | null;
}

export const ALL_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Distinct, ascending ISO weekdays; null when empty or when any value is not 1..7. */
export function normalizeDays(days: readonly number[] | null | undefined): number[] | null {
  if (!days || days.length === 0) return null;
  const out = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) return null;
    out.add(d);
  }
  return [...out].sort((a, b) => a - b);
}

/** The schedule as sent by a client when editing: days only (the time comes from the due time). */
export const recurrenceInputSchema = z
  .object({
    days: z
      .array(z.number().int().min(1, 'Days are numbered 1 (Monday) to 7 (Sunday).').max(7))
      .min(1, 'Choose at least one day.')
      .max(7),
  })
  .strict()
  .nullable();

/** "HH:mm" of an instant on the wall clock of `timezone`. */
export function localTimeOf(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('HH:mm');
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of an instant in `timezone`. */
export function localWeekdayOf(instant: Date, timezone: string): number {
  return DateTime.fromJSDate(instant, { zone: timezone }).weekday;
}

function atLocalTime(day: DateTime, time: string | null): DateTime {
  const start = day.startOf('day');
  if (time === null) return start;
  if (!TIME_RE.test(time)) throw new Error('Invalid recurrence time');
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  // A wall time that does not exist (spring-forward gap) resolves to the next valid instant.
  return start.set({ hour, minute, second: 0, millisecond: 0 });
}

/** The first occurrence strictly after `after`. Always found: a rule repeats within 7 days. */
export function nextOccurrence(rule: Recurrence, after: Date, timezone: string): Date {
  const days = normalizeDays(rule.days);
  if (!days) throw new Error('A recurrence needs at least one weekday');
  const local = DateTime.fromJSDate(after, { zone: timezone });
  for (let i = 0; i <= 8; i++) {
    const day = local.startOf('day').plus({ days: i });
    if (!days.includes(day.weekday)) continue;
    const candidate = atLocalTime(day, rule.time);
    if (candidate.toMillis() > after.getTime()) return candidate.toUTC().toJSDate();
  }
  throw new Error('No occurrence found'); // unreachable for a valid rule
}

/** The latest occurrence at or before `at`, or null when the rule has none in the last 8 days. */
export function previousOccurrence(rule: Recurrence, at: Date, timezone: string): Date | null {
  const days = normalizeDays(rule.days);
  if (!days) return null;
  const local = DateTime.fromJSDate(at, { zone: timezone });
  for (let i = 0; i <= 8; i++) {
    const day = local.startOf('day').minus({ days: i });
    if (!days.includes(day.weekday)) continue;
    const candidate = atLocalTime(day, rule.time);
    if (candidate.toMillis() <= at.getTime()) return candidate.toUTC().toJSDate();
  }
  return null;
}

/** Stored columns -> rule (null for a one-off reminder). */
export function ruleFromRow(row: {
  recurrenceDays: number[] | null;
  recurrenceTime: string | null;
}): Recurrence | null {
  const days = normalizeDays(row.recurrenceDays);
  return days ? { days, time: row.recurrenceTime } : null;
}

export const sameRule = (a: Recurrence | null, b: Recurrence | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.time === b.time && a.days.length === b.days.length && a.days.every((d, i) => d === b.days[i])
  );
};
