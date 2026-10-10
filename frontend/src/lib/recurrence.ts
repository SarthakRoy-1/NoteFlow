// Wording for a repeating schedule. Days are ISO weekdays: 1 = Monday ... 7 = Sunday.
// The time is the owner's wall clock ("HH:mm") and is shown as it is.

const NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** Short labels in week order, for the day pickers. */
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAYS = [1, 2, 3, 4, 5];

export interface RecurrenceLike {
  days: number[];
  time: string | null;
}

export function describeRecurrence(recurrence: RecurrenceLike): string {
  const days = [...new Set(recurrence.days)].sort((a, b) => a - b);
  let when: string;
  if (days.length === 7) {
    when = 'day';
  } else if (days.join(',') === WEEKDAYS.join(',')) {
    when = 'weekday';
  } else {
    const names = days.map((d) => NAMES[d - 1]).filter((n): n is (typeof NAMES)[number] => !!n);
    when =
      names.length <= 1
        ? (names[0] ?? 'week')
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  const base = `Every ${when}`;
  return recurrence.time ? `${base} at ${recurrence.time}` : base;
}
