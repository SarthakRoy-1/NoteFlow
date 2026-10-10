import {
  localTimeOf,
  localWeekdayOf,
  nextOccurrence,
  type Recurrence,
} from '../../lib/recurrence.js';
import { hasNul } from '../../lib/text.js';
import type { ResolvedDue } from '../../lib/dueInput.js';
import { anchorDateOnly, resolveDue } from './dates.js';
import {
  RECURRENCE_CUE_RE,
  UNSUPPORTED_RECURRENCE_RE,
  daysForKind,
  parseRecurrenceDays,
} from './recurrence.js';
import type { RawExtraction, RawItem } from './schema.js';

export const MAX_ITEMS = 20;
export const MAX_TEXT = 200;
export const MAX_PERSON = 80;

/** A validated, normalized item that is safe to hand to reconciliation. */
export interface ExtractedItem {
  kind: 'todo' | 'reminder';
  text: string;
  person: string | null;
  evidence: string;
  dueAt: Date | null;
  dueHasTime: boolean;
  /** ISO weekdays of a repeating reminder (dueAt is then its next occurrence); null = one-off. */
  recurrenceDays: number[] | null;
  /** "HH:mm" in the user's timezone; null = alert at the start of each such day. */
  recurrenceTime: string | null;
}

export interface ValidationResult {
  items: ExtractedItem[];
  /** How many model items were discarded by business rules (for diagnostics only). */
  dropped: number;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Lowercase, collapse whitespace, unify curly quotes/dashes so harmless model reformatting still matches. */
export function normalizeForMatch(s: string): string {
  return collapse(
    s
      .normalize('NFKC')
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .toLowerCase(),
  );
}

/**
 * Business-rule validation + normalization of schema-valid model output.
 * Items that cannot be grounded in the note are dropped; weak date claims are downgraded or removed.
 */
export function validateExtraction(
  raw: RawExtraction,
  ctx: { title: string; content: string; timezone: string; now: Date },
): ValidationResult {
  const haystack = normalizeForMatch(`${ctx.title}\n${ctx.content}`);
  const groundedIn = (text: string) => {
    const needle = normalizeForMatch(text);
    return needle.length > 0 && haystack.includes(needle);
  };

  const items: ExtractedItem[] = [];
  let dropped = 0;

  for (const rawItem of raw.items) {
    const item = validateOne(rawItem, groundedIn, ctx);
    if (!item) {
      dropped++;
    } else if (items.length < MAX_ITEMS) {
      items.push(item);
    } else {
      dropped++;
    }
  }
  return { items, dropped };
}

function validateOne(
  raw: RawItem,
  groundedIn: (text: string) => boolean,
  ctx: { timezone: string; now: Date },
): ExtractedItem | null {
  const text = collapse(raw.text);
  // A NUL cannot be stored in PostgreSQL text; drop the item instead of failing the whole analysis.
  if (!text || text.length > MAX_TEXT || hasNul(text)) return null;

  // An item must be supported by words that are really in the note.
  const evidence = collapse(raw.evidence);
  if (!evidence || !groundedIn(evidence)) return null;

  let person: string | null = null;
  if (raw.kind === 'reminder' && raw.person) {
    const candidate = collapse(raw.person);
    if (candidate && candidate.length <= MAX_PERSON && groundedIn(candidate)) person = candidate;
  }

  const due = resolveDue(raw, { now: ctx.now, timezone: ctx.timezone, groundedIn });
  let dueAt = due.dueAt;
  if (dueAt && !due.dueHasTime && raw.kind === 'todo') {
    dueAt = anchorDateOnly(dueAt, ctx.timezone, 'end');
  }

  const recurrence = resolveRecurrence(raw, due, groundedIn, ctx.timezone);
  if (recurrence) {
    // The first alert is the next occurrence of the rule, computed here, not the model's date.
    return {
      kind: raw.kind,
      text,
      person,
      evidence,
      dueAt: nextOccurrence(recurrence, ctx.now, ctx.timezone),
      dueHasTime: recurrence.time !== null,
      recurrenceDays: recurrence.days,
      recurrenceTime: recurrence.time,
    };
  }

  return {
    kind: raw.kind,
    text,
    person,
    evidence,
    dueAt,
    dueHasTime: dueAt ? due.dueHasTime : false,
    recurrenceDays: null,
    recurrenceTime: null,
  };
}

/**
 * A repeating schedule, or null (the reminder then stays a one-off). Only reminders repeat, the
 * quoted words must really be in the note and really state a supported repetition, and the days
 * come from those words when they name any. Nothing is guessed: any doubt means "does not repeat".
 */
function resolveRecurrence(
  raw: RawItem,
  due: ResolvedDue,
  groundedIn: (text: string) => boolean,
  timezone: string,
): Recurrence | null {
  const kind = raw.recurrence_kind ?? 'none';
  if (raw.kind !== 'reminder' || kind === 'none') return null;
  // "in two hours, every day" has no time of day to repeat at.
  if (raw.due_kind === 'relative') return null;

  const expression = collapse(raw.recurrence_expression ?? '');
  if (!expression || !groundedIn(expression)) return null;
  if (!RECURRENCE_CUE_RE.test(expression) || UNSUPPORTED_RECURRENCE_RE.test(expression))
    return null;

  let days = parseRecurrenceDays(expression) ?? daysForKind(kind, raw.recurrence_weekdays);
  // "weekly, Friday 5pm" with no named day: the day of the stated first date.
  if (!days && kind === 'weekly' && due.dueAt) days = [localWeekdayOf(due.dueAt, timezone)];
  if (!days) return null;

  const time = due.dueAt && due.dueHasTime ? localTimeOf(due.dueAt, timezone) : null;
  return { days, time };
}
