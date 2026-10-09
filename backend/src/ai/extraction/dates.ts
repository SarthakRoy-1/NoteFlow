import { DateTime } from 'luxon';
import type { ResolvedDue } from '../../lib/dueInput.js';
import type { RawItem } from './schema.js';

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Hour 24 is refused: Luxon would read "T24:00" as the next day's midnight, silently moving the date.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
/** Wording that really states a time of day or a duration. "morning"/"tonight"/"sometime" do not. */
const TIME_WORDING_RE = /\d|noon|midnight|\bhours?\b|\bhrs?\b|\bminutes?\b|\bmins?\b/i;

const MAX_PAST_DAYS = 366;
const MAX_FUTURE_YEARS = 5;
const MAX_RELATIVE_MINUTES = 60 * 24 * 30;

export function nowIn(now: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(now, { zone: timezone });
}

/**
 * Plain-text calendar the model can look dates up in. Resolving "next Friday" is deterministic
 * here (backend) instead of being left to the model's calendar arithmetic.
 *
 * Convention: "Friday" = the first Friday strictly after today; "next Friday" = the Friday of the
 * following calendar week (weeks start on Monday).
 */
export function buildTimeContext(now: Date, timezone: string): string {
  const local = nowIn(now, timezone);
  const today = local.startOf('day');
  const fmt = (d: DateTime) => d.toFormat('yyyy-MM-dd');
  const nextWeekMonday = today.startOf('week').plus({ weeks: 1 });

  const lines = [
    `Current local date and time: ${local.toFormat('yyyy-MM-dd HH:mm')} (${WEEKDAYS[local.weekday - 1]}), timezone ${timezone} (UTC${local.toFormat('ZZ')})`,
    `today = ${fmt(today)}`,
    `tomorrow = ${fmt(today.plus({ days: 1 }))}`,
    `day after tomorrow = ${fmt(today.plus({ days: 2 }))}`,
    'Weekday lookup ("<weekday>" = first such day after today; "next <weekday>" = that day in the following calendar week, weeks start Monday):',
  ];
  WEEKDAYS.forEach((name, i) => {
    let upcoming = today.plus({ days: 1 });
    while (upcoming.weekday !== i + 1) upcoming = upcoming.plus({ days: 1 });
    const next = nextWeekMonday.plus({ days: i });
    lines.push(`- ${name}: ${fmt(upcoming)}; next ${name}: ${fmt(next)}`);
  });
  return lines.join('\n');
}

const NO_DUE: ResolvedDue = { dueAt: null, dueHasTime: false };

/**
 * Turn the model's date claim into a UTC instant, or drop it. This never throws and never guesses:
 * anything ungrounded, malformed or implausible becomes "no due date" while the item itself survives.
 *
 * - date-only    -> dueHasTime=false; instant is the START of that local day (callers may re-anchor)
 * - datetime     -> only if the quoted wording really contains a time; otherwise downgraded to date-only
 * - relative     -> now + minutes
 */
export function resolveDue(
  item: RawItem,
  opts: { now: Date; timezone: string; groundedIn: (text: string) => boolean },
): ResolvedDue {
  const { now, timezone } = opts;
  if (item.due_kind === 'none') return NO_DUE;

  const expression = item.due_expression?.trim();
  if (!expression || !opts.groundedIn(expression)) return NO_DUE;

  let result: ResolvedDue = NO_DUE;

  if (item.due_kind === 'relative') {
    const minutes = item.due_relative_minutes;
    if (minutes == null || minutes < 1 || minutes > MAX_RELATIVE_MINUTES) return NO_DUE;
    result = { dueAt: new Date(now.getTime() + minutes * 60_000), dueHasTime: true };
  } else {
    const local = item.due_local?.trim();
    if (!local) return NO_DUE;
    const isDateTime = DATETIME_RE.test(local);
    if (!isDateTime && !DATE_RE.test(local)) return NO_DUE;
    const parsed = DateTime.fromISO(local, { zone: timezone });
    if (!parsed.isValid) return NO_DUE;

    const wantsTime = item.due_kind === 'datetime' && isDateTime;
    if (wantsTime && TIME_WORDING_RE.test(expression)) {
      result = { dueAt: parsed.toUTC().toJSDate(), dueHasTime: true };
    } else {
      // Date only: either the model said so, or it claimed a time the note never stated.
      const day = parsed.startOf('day');
      result = { dueAt: day.toUTC().toJSDate(), dueHasTime: false };
    }
  }

  // Plausibility window: a wildly wrong date is worse than none.
  const earliest = now.getTime() - MAX_PAST_DAYS * 86_400_000;
  const latest = now.getTime() + MAX_FUTURE_YEARS * 366 * 86_400_000;
  if (!result.dueAt || result.dueAt.getTime() < earliest || result.dueAt.getTime() > latest) {
    return NO_DUE;
  }
  return result;
}

/** Date-only values are stored as an instant; this picks the anchor (end for todos, start for reminders). */
export function anchorDateOnly(dueAt: Date, timezone: string, anchor: 'start' | 'end'): Date {
  const day = DateTime.fromJSDate(dueAt, { zone: timezone }).startOf('day');
  return (anchor === 'end' ? day.endOf('day') : day).toUTC().toJSDate();
}
