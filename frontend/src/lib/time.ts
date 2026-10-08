// Display helpers for stored instants. Everything is rendered in the USER's timezone (from their
// account), never the browser's or the server's. No time of day is ever invented for date-only values.

const LOCALE = 'en-GB';

export function formatDue(iso: string, hasTime: boolean, timeZone: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  }).format(date);
}

/** "yyyy-MM-dd" in the given timezone, for <input type="date">. */
export function toInputDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** "HH:mm" in the given timezone, for <input type="time">. */
export function toInputTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** True when a due instant is already in the past. (Date-only dues are stored as end-of-day.) */
export function isPast(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() < now.getTime();
}
