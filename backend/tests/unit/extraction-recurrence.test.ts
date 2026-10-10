import { describe, expect, it } from 'vitest';
import { parseRecurrenceDays } from '../../src/ai/extraction/recurrence.js';
import { rawExtractionSchema } from '../../src/ai/extraction/schema.js';
import { validateExtraction } from '../../src/ai/extraction/validate.js';
import { item } from '../helpers/fakeAi.js';

/** Thursday 8 Oct 2026, 10:00 UTC = 15:30 in Kolkata. */
const NOW = new Date('2026-10-08T10:00:00Z');
const TZ = 'Asia/Kolkata';

/** Runs the same parse -> validate path the application uses. */
function run(content: string, partial: Record<string, unknown>, tz = TZ) {
  const raw = rawExtractionSchema.parse({ items: [item({ kind: 'reminder', ...partial })] });
  const { items } = validateExtraction(raw, { title: 'Note', content, timezone: tz, now: NOW });
  expect(items).toHaveLength(1);
  return items[0];
}

const iso = (d: Date | null | undefined) => d?.toISOString();

describe('repeating reminders', () => {
  it('reads "every Monday at 9am" as a weekly schedule and computes the first occurrence itself', () => {
    const r = run('Remind me to send the report every Monday at 9am', {
      text: 'Send the report',
      evidence: 'send the report every monday at 9am',
      due_kind: 'datetime',
      due_expression: 'every Monday at 9am',
      // The model's own date is ignored: the backend derives the first occurrence from the rule.
      due_local: '2026-10-19T09:00',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [1],
      recurrence_expression: 'every Monday',
    });
    expect(r).toMatchObject({ recurrenceDays: [1], recurrenceTime: '09:00', dueHasTime: true });
    expect(iso(r?.dueAt)).toBe('2026-10-12T03:30:00.000Z'); // Monday 12 Oct 09:00 IST
  });

  it('takes the days from the words, not from the model weekday numbers', () => {
    const r = run('Gym reminder every Monday at 7am', {
      text: 'Go to the gym',
      evidence: 'gym reminder every monday at 7am',
      due_kind: 'datetime',
      due_expression: 'every Monday at 7am',
      due_local: '2026-10-12T07:00',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [2, 6], // wrong on purpose
      recurrence_expression: 'every Monday',
    });
    expect(r?.recurrenceDays).toEqual([1]);
  });

  it('handles several named days', () => {
    const r = run('Remind me to stretch every Monday and Thursday at 6pm', {
      text: 'Stretch',
      evidence: 'stretch every monday and thursday at 6pm',
      due_kind: 'datetime',
      due_expression: 'every Monday and Thursday at 6pm',
      due_local: '2026-10-08T18:00',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [1, 4],
      recurrence_expression: 'every Monday and Thursday',
    });
    expect(r).toMatchObject({ recurrenceDays: [1, 4], recurrenceTime: '18:00' });
    // Thursday 18:00 IST is still ahead today (it is 15:30).
    expect(iso(r?.dueAt)).toBe('2026-10-08T12:30:00.000Z');
  });

  it('reads "every weekday" as Monday to Friday', () => {
    const r = run('Remind me to log my hours every weekday at 9am', {
      text: 'Log my hours',
      evidence: 'log my hours every weekday at 9am',
      due_kind: 'datetime',
      due_expression: 'every weekday at 9am',
      due_local: '2026-10-09T09:00',
      recurrence_kind: 'weekdays',
      recurrence_expression: 'every weekday',
    });
    expect(r?.recurrenceDays).toEqual([1, 2, 3, 4, 5]);
    expect(iso(r?.dueAt)).toBe('2026-10-09T03:30:00.000Z'); // Friday 09:00 IST
  });

  it('a daily reminder with no time repeats at the start of each day (nothing is invented)', () => {
    const r = run('Remind me to water the plants every day', {
      text: 'Water the plants',
      evidence: 'water the plants every day',
      due_kind: 'none',
      recurrence_kind: 'daily',
      recurrence_expression: 'every day',
    });
    expect(r).toMatchObject({
      recurrenceDays: [1, 2, 3, 4, 5, 6, 7],
      recurrenceTime: null,
      dueHasTime: false,
    });
    expect(iso(r?.dueAt)).toBe('2026-10-08T18:30:00.000Z'); // Friday 00:00 IST
  });

  it('uses the weekday of the stated first date for a weekly reminder naming no day', () => {
    const r = run('Review the budget every week, starting Friday at 5pm', {
      text: 'Review the budget',
      evidence: 'review the budget every week',
      due_kind: 'datetime',
      due_expression: 'Friday at 5pm',
      due_local: '2026-10-09T17:00',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [],
      recurrence_expression: 'every week',
    });
    expect(r).toMatchObject({ recurrenceDays: [5], recurrenceTime: '17:00' });
  });

  it('does not repeat when the quoted words are not in the note', () => {
    const r = run('Send the invoice on Friday at 5pm', {
      text: 'Send the invoice',
      evidence: 'send the invoice on friday at 5pm',
      due_kind: 'datetime',
      due_expression: 'Friday at 5pm',
      due_local: '2026-10-09T17:00',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [5],
      recurrence_expression: 'every Friday',
    });
    expect(r).toMatchObject({ recurrenceDays: null, recurrenceTime: null });
    expect(iso(r?.dueAt)).toBe('2026-10-09T11:30:00.000Z'); // the one-off date survives
  });

  it.each([
    ['every other Monday', 'Pay rent every other Monday'],
    ['every 2 weeks', 'Pay rent every 2 weeks'],
    ['every two weeks', 'Pay rent every two weeks'],
    ['monthly', 'Pay rent monthly'],
    ['every month', 'Pay rent every month'],
    ['every weekday except Wednesday', 'Pay rent every weekday except Wednesday'],
    ['every first Monday', 'Pay rent every first Monday'],
    ['yearly', 'Pay rent yearly'],
    ['every hour', 'Pay rent every hour'],
    ['fortnightly', 'Pay rent fortnightly'],
  ])('leaves %j as a one-off (unsupported repetition is never guessed)', (expression, content) => {
    const r = run(content, {
      text: 'Pay rent',
      evidence: content.toLowerCase(),
      due_kind: 'none',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [1],
      recurrence_expression: expression,
    });
    expect(r?.recurrenceDays).toBeNull();
  });

  it('needs a repetition cue: a plain weekday is a date, not a schedule', () => {
    const r = run('Call the bank Monday', {
      text: 'Call the bank',
      evidence: 'call the bank monday',
      due_kind: 'none',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [1],
      recurrence_expression: 'Monday',
    });
    expect(r?.recurrenceDays).toBeNull();
  });

  it('ignores a recurrence claimed on a todo', () => {
    const raw = rawExtractionSchema.parse({
      items: [
        item({
          kind: 'todo',
          text: 'Take out the bins',
          evidence: 'take out the bins every monday',
          recurrence_kind: 'weekly',
          recurrence_weekdays: [1],
          recurrence_expression: 'every Monday',
        }),
      ],
    });
    const { items } = validateExtraction(raw, {
      title: 'Chores',
      content: 'Take out the bins every Monday',
      timezone: TZ,
      now: NOW,
    });
    expect(items[0]).toMatchObject({ kind: 'todo', recurrenceDays: null });
  });

  it('does not repeat a relative time ("in two hours, every day")', () => {
    const r = run('Stretch in two hours every day', {
      text: 'Stretch',
      evidence: 'stretch in two hours every day',
      due_kind: 'relative',
      due_expression: 'in two hours',
      due_relative_minutes: 120,
      recurrence_kind: 'daily',
      recurrence_expression: 'every day',
    });
    expect(r).toMatchObject({ recurrenceDays: null, dueHasTime: true });
  });

  it('ignores an unusable weekday list when the words name no day and there is no date', () => {
    const r = run('Tidy the desk every week', {
      text: 'Tidy the desk',
      evidence: 'tidy the desk every week',
      due_kind: 'none',
      recurrence_kind: 'weekly',
      recurrence_weekdays: [0, 9],
      recurrence_expression: 'every week',
    });
    expect(r?.recurrenceDays).toBeNull();
  });

  it('a reply without any recurrence fields is simply a one-off', () => {
    const base = item({ kind: 'reminder', text: 'Call John', evidence: 'call john' });
    const stripped = Object.fromEntries(
      Object.entries(base).filter(([k]) => !k.startsWith('recurrence_')),
    );
    const raw = rawExtractionSchema.parse({ items: [stripped] });
    const { items } = validateExtraction(raw, {
      title: 'T',
      content: 'Call John',
      timezone: TZ,
      now: NOW,
    });
    expect(items[0]).toMatchObject({ recurrenceDays: null, recurrenceTime: null });
  });

  it('keeps wall-clock time for another timezone (New York, 9am)', () => {
    const r = run(
      'Remind me to submit timesheets every Friday at 9am',
      {
        text: 'Submit timesheets',
        evidence: 'submit timesheets every friday at 9am',
        due_kind: 'datetime',
        due_expression: 'every Friday at 9am',
        due_local: '2026-10-09T09:00',
        recurrence_kind: 'weekly',
        recurrence_weekdays: [5],
        recurrence_expression: 'every Friday',
      },
      'America/New_York',
    );
    expect(iso(r?.dueAt)).toBe('2026-10-09T13:00:00.000Z'); // 09:00 EDT
    expect(r?.recurrenceTime).toBe('09:00');
  });
});

describe('parseRecurrenceDays', () => {
  it.each([
    ['every Monday', [1]],
    ['every Tue and Thu', [2, 4]],
    ['on Mondays', [1]],
    ['every Monday, Wednesday and Friday', [1, 3, 5]],
    ['Monday to Friday', [1, 2, 3, 4, 5]],
    ['Friday through Monday', [1, 5, 6, 7]],
    ['Mon-Fri', [1, 2, 3, 4, 5]],
    ['every weekday', [1, 2, 3, 4, 5]],
    ['on weekends', [6, 7]],
    ['daily', [1, 2, 3, 4, 5, 6, 7]],
    ['every day', [1, 2, 3, 4, 5, 6, 7]],
    ['every evening', [1, 2, 3, 4, 5, 6, 7]],
  ])('%j -> %j', (expression, days) => {
    expect(parseRecurrenceDays(expression)).toEqual(days);
  });

  it.each([['every week'], ['once in a while'], ['the month of May']])(
    '%j names no days',
    (expression) => {
      expect(parseRecurrenceDays(expression)).toBeNull();
    },
  );
});
