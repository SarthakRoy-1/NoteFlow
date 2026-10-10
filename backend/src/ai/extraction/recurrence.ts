import { ALL_DAYS, WEEKDAYS, normalizeDays } from '../../lib/recurrence.js';

/**
 * The model says WHICH words express a repetition; this module decides what they mean, so a wrong
 * weekday number from the model can never create the wrong schedule. English only, like the rest
 * of the date wording checks: anything not recognised leaves the reminder a one-off.
 */

/** Words that make a phrase a repetition at all. A bare "Monday" is just a date. */
export const RECURRENCE_CUE_RE =
  /\b(every|each|daily|weekly|everyday|weekdays|weekends|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/i;

/** Repetitions this app does not model. Better a one-off reminder than a wrong schedule. */
export const UNSUPPORTED_RECURRENCE_RE =
  /\b(other|alternate|alternating|alternately|fortnight\w*|bi-?weekly|bi-?monthly|semi-?\w+|monthly|quarterly|yearly|annual\w*|months?|years?|hours?|hourly|minutes?|except|excluding|apart from|besides|but not|other than|unless|first|second|third|fourth|last)\b|\bevery\s+\d|\bevery\s+(two|three|four|five|six|seven|eight|nine|ten)\b/i;

const DAY_NAMES: [string, number][] = [
  ['mon(?:day)?s?', 1],
  ['tue(?:s|sday)?s?', 2],
  ['wed(?:nesday)?s?', 3],
  ['thu(?:r|rs|rsday)?s?', 4],
  ['fri(?:day)?s?', 5],
  ['sat(?:urday)?s?', 6],
  ['sun(?:day)?s?', 7],
];

const NAME_ALTERNATION = DAY_NAMES.map(([pattern]) => `(${pattern})`).join('|');
const RANGE_RE = new RegExp(
  `\\b(${NAME_ALTERNATION})\\b\\s*(?:-|\\u2013|to|through|thru|until)\\s*\\b(${NAME_ALTERNATION})\\b`,
  'g',
);

const dayOf = (word: string): number | null => {
  for (const [pattern, day] of DAY_NAMES) {
    if (new RegExp(`^${pattern}$`).test(word)) return day;
  }
  return null;
};

/** Days between two weekdays inclusive, wrapping over Sunday ("Friday to Monday"). */
function span(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = from; ; d = (d % 7) + 1) {
    out.push(d);
    if (d === to) return out;
  }
}

/**
 * Weekdays named by a recurrence phrase, or null when the words do not name any. Handles day names
 * ("every Monday and Thursday"), ranges ("Monday to Friday"), "weekdays", "weekends" and "daily".
 */
export function parseRecurrenceDays(expression: string): number[] | null {
  const text = expression.toLowerCase();
  const days = new Set<number>();

  // Ranges first, then blank them out so their end points are not read again as single names.
  const withoutRanges = text.replace(RANGE_RE, (match) => {
    const parts = match.split(/\s*(?:-|–|to|through|thru|until)\s*/).map((w) => w.trim());
    const from = dayOf(parts[0] ?? '');
    const to = dayOf(parts[parts.length - 1] ?? '');
    if (from !== null && to !== null) for (const d of span(from, to)) days.add(d);
    return ' ';
  });

  for (const word of withoutRanges.match(/[a-z]+/g) ?? []) {
    const day = dayOf(word);
    if (day !== null) days.add(day);
  }
  if (days.size > 0) return normalizeDays([...days]);

  if (/\bweekdays?\b/.test(text)) return [...WEEKDAYS];
  if (/\bweekends?\b/.test(text)) return [6, 7];
  if (
    /\b(daily|everyday|every\s+day|each\s+day|every\s+(morning|afternoon|evening|night))\b/.test(
      text,
    )
  ) {
    return [...ALL_DAYS];
  }
  return null;
}

/** The days implied by the model's own structured fields (used only when the words name none). */
export function daysForKind(
  kind: 'none' | 'daily' | 'weekdays' | 'weekly',
  weekdays: readonly number[] | null | undefined,
): number[] | null {
  if (kind === 'daily') return [...ALL_DAYS];
  if (kind === 'weekdays') return [...WEEKDAYS];
  if (kind === 'weekly') return normalizeDays(weekdays);
  return null;
}
