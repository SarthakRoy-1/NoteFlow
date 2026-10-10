export interface ReminderTiming {
  dueAt: Date | null;
  dueHasTime: boolean;
  recurrenceDays: number[] | null;
  recurrenceTime: string | null;
}

const validInstant = (d: Date | null): d is Date => d !== null && !Number.isNaN(d.getTime());

/**
 * A reminder is only a reminder once it has a real date AND a real time of day. A date alone
 * ("Friday") or nothing at all is a draft: the user is asked for the rest, nothing is guessed.
 * A repeating reminder needs its time of day; its next occurrence is then computed from it.
 */
export function isCompleteReminder(t: ReminderTiming): boolean {
  if (t.recurrenceDays && t.recurrenceDays.length > 0) {
    return t.recurrenceTime !== null && validInstant(t.dueAt);
  }
  return validInstant(t.dueAt) && t.dueHasTime;
}
