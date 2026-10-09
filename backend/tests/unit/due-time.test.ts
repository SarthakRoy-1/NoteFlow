import { describe, expect, it } from 'vitest';
import { anchorDateOnly, buildTimeContext, resolveDue } from '../../src/ai/extraction/dates.js';
import type { RawItem } from '../../src/ai/extraction/schema.js';
import { dueInputSchema, resolveDueInput } from '../../src/lib/dueInput.js';
import { isValidIanaTimezone } from '../../src/lib/timezone.js';
import { item } from '../helpers/fakeAi.js';

/**
 * Every assertion here is about the stored INSTANT (a UTC ISO string), never about a formatted label.
 * DST policy is Luxon's, unchanged: a local time that does not exist (spring-forward gap) moves
 * forward by the gap; a local time that occurs twice (fall-back) takes the FIRST occurrence.
 */
const KOLKATA = 'Asia/Kolkata';
const NY = 'America/New_York';

const manual = (date: string, time: string | null, tz: string, anchor: 'start' | 'end' = 'end') => {
  const r = resolveDueInput({ date, time }, tz, anchor);
  return r && { at: r.dueAt?.toISOString(), hasTime: r.dueHasTime };
};

describe('manual due dates (todos and reminders share this)', () => {
  it('Asia/Kolkata 2026-10-09 17:00 is 11:30 UTC', () => {
    expect(manual('2026-10-09', '17:00', KOLKATA)).toEqual({
      at: '2026-10-09T11:30:00.000Z',
      hasTime: true,
    });
  });

  it('the legacy id Asia/Calcutta (what the dev account stores) behaves the same', () => {
    expect(manual('2026-10-09', '17:00', 'Asia/Calcutta')?.at).toBe('2026-10-09T11:30:00.000Z');
  });

  it('00:00 and 23:59 cross the UTC calendar day in opposite directions', () => {
    // Kolkata is ahead of UTC: local midnight is the previous UTC day.
    expect(manual('2026-10-09', '00:00', KOLKATA)?.at).toBe('2026-10-08T18:30:00.000Z');
    expect(manual('2026-10-09', '23:59', KOLKATA)?.at).toBe('2026-10-09T18:29:00.000Z');
    // New York is behind UTC: local 23:59 is the next UTC day.
    expect(manual('2026-10-09', '23:59', NY)?.at).toBe('2026-10-10T03:59:00.000Z');
  });

  it('date only invents no time: start of the local day (reminders) or end of it (todos)', () => {
    expect(manual('2026-10-09', null, KOLKATA, 'start')).toEqual({
      at: '2026-10-08T18:30:00.000Z',
      hasTime: false,
    });
    expect(manual('2026-10-09', null, KOLKATA, 'end')).toEqual({
      at: '2026-10-09T18:29:59.999Z',
      hasTime: false,
    });
  });

  describe('daylight saving (America/New_York)', () => {
    it('spring forward: 2026-03-08 has 23 hours, the offset changes at 02:00', () => {
      expect(manual('2026-03-08', '01:59', NY)?.at).toBe('2026-03-08T06:59:00.000Z'); // EST -5
      expect(manual('2026-03-08', '03:00', NY)?.at).toBe('2026-03-08T07:00:00.000Z'); // EDT -4
      expect(manual('2026-03-08', null, NY, 'start')?.at).toBe('2026-03-08T05:00:00.000Z');
      expect(manual('2026-03-08', null, NY, 'end')?.at).toBe('2026-03-09T03:59:59.999Z');
    });

    it('fall back: 2026-11-01 has 25 hours', () => {
      expect(manual('2026-11-01', null, NY, 'start')?.at).toBe('2026-11-01T04:00:00.000Z'); // EDT
      expect(manual('2026-11-01', null, NY, 'end')?.at).toBe('2026-11-02T04:59:59.999Z'); // EST
      expect(manual('2026-11-01', '02:00', NY)?.at).toBe('2026-11-01T07:00:00.000Z'); // EST -5
    });

    it('a local time inside the spring-forward gap moves forward by the gap', () => {
      expect(manual('2026-03-08', '02:30', NY)?.at).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT
    });

    it('an ambiguous fall-back local time takes the first (daylight) occurrence', () => {
      expect(manual('2026-11-01', '01:30', NY)?.at).toBe('2026-11-01T05:30:00.000Z'); // 01:30 EDT
    });

    it('the same wall-clock time a week apart differs by one hour of offset', () => {
      const before = manual('2026-03-01', '09:00', NY)?.at;
      const after = manual('2026-03-15', '09:00', NY)?.at;
      expect(before).toBe('2026-03-01T14:00:00.000Z');
      expect(after).toBe('2026-03-15T13:00:00.000Z');
    });
  });

  it('accepts a leap day and rejects a day that does not exist', () => {
    expect(manual('2028-02-29', '12:00', 'UTC')?.at).toBe('2028-02-29T12:00:00.000Z');
    expect(manual('2027-02-29', null, 'UTC')).toBeNull();
    expect(manual('2026-04-31', '10:00', 'UTC')).toBeNull();
    expect(manual('2026-13-01', null, 'UTC')).toBeNull();
  });

  it('rejects years outside 2000-2100', () => {
    expect(manual('1999-12-31', null, 'UTC')).toBeNull();
    expect(manual('2101-01-01', null, 'UTC')).toBeNull();
  });
});

describe('due input validation (what a client may send)', () => {
  it.each([
    [{ date: '2026-10-09' }],
    [{ date: '2026-10-09', time: '17:00' }],
    [{ date: '2026-10-09', time: null }],
    [null],
  ])('accepts %j', (v) => expect(dueInputSchema.safeParse(v).success).toBe(true));

  it.each([
    ['a missing date', { time: '17:00' }],
    ['a non-ISO date', { date: '09/10/2026' }],
    ['a date with a time zone suffix', { date: '2026-10-09T17:00:00Z' }],
    ['hour 24', { date: '2026-10-09', time: '24:00' }],
    ['minute 60', { date: '2026-10-09', time: '17:60' }],
    ['seconds', { date: '2026-10-09', time: '17:00:00' }],
    ['a 12-hour time', { date: '2026-10-09', time: '5pm' }],
    ['a raw timestamp', { date: '2026-10-09', time: '17:00', dueAt: '2026-10-09T11:30:00Z' }],
    ['a user_id', { date: '2026-10-09', user_id: 'x' }],
    ['an offset', { date: '2026-10-09', time: '17:00', offset: '+05:30' }],
    ['a number', 20261009],
    ['a string', '2026-10-09'],
  ])('rejects %s', (_n, v) => expect(dueInputSchema.safeParse(v).success).toBe(false));
});

describe('account timezone validation', () => {
  it.each(['UTC', 'Asia/Kolkata', 'Asia/Calcutta', 'America/New_York', 'Europe/London'])(
    'accepts %s',
    (z) => expect(isValidIanaTimezone(z)).toBe(true),
  );
  it.each(['', ' ', 'EST', 'IST', 'GMT+5', '+05:30', 'Mars/Olympus', 'America/', '/UTC', 'utc '])(
    'rejects %j',
    (z) => expect(isValidIanaTimezone(z)).toBe(false),
  );
});

describe('AI-extracted dates (resolved in the user timezone)', () => {
  // Saturday 7 Mar 2026, 20:00 in New York (EST); the clocks change the next night.
  const SAT_EVENING = new Date('2026-03-08T01:00:00Z');
  const always = () => true;
  const raw = (p: Partial<RawItem>): RawItem => item(p) as RawItem;
  const run = (p: Partial<RawItem>, tz = NY, now = SAT_EVENING) =>
    resolveDue(raw(p), { now, timezone: tz, groundedIn: always });

  it('"tomorrow" across the spring-forward night is a 23-hour day that starts at 05:00Z', () => {
    const r = run({ due_kind: 'date', due_expression: 'tomorrow', due_local: '2026-03-08' });
    expect(r).toEqual({ dueAt: new Date('2026-03-08T05:00:00Z'), dueHasTime: false });
    // Todos re-anchor to the end of that local day.
    expect(anchorDateOnly(r.dueAt!, NY, 'end').toISOString()).toBe('2026-03-09T03:59:59.999Z');
  });

  it('a time on the far side of the change uses the new offset', () => {
    const r = run({
      due_kind: 'datetime',
      due_expression: 'tomorrow at 9am',
      due_local: '2026-03-08T09:00',
    });
    expect(r.dueAt?.toISOString()).toBe('2026-03-08T13:00:00.000Z'); // EDT -4
    expect(r.dueHasTime).toBe(true);
  });

  it('fall back: 01:30 tomorrow is the first occurrence', () => {
    const r = run(
      { due_kind: 'datetime', due_expression: 'at 1:30am', due_local: '2026-11-01T01:30' },
      NY,
      new Date('2026-10-31T20:00:00Z'),
    );
    expect(r.dueAt?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('"in two hours" is real elapsed time, even across the clock change', () => {
    // 00:30 EST on 8 March + 2 hours of elapsed time is 03:30 EDT (the clock skips 02:00-03:00).
    const now = new Date('2026-03-08T05:30:00Z');
    const r = run(
      { due_kind: 'relative', due_expression: 'in two hours', due_relative_minutes: 120 },
      NY,
      now,
    );
    expect(r.dueAt?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(r.dueHasTime).toBe(true);
  });

  it('Asia/Kolkata: "tomorrow at 5pm" from late evening UTC is the next Kolkata day', () => {
    // 23:00Z on 8 Oct is already 04:30 on 9 Oct in Kolkata, so "tomorrow" is 10 Oct.
    const now = new Date('2026-10-08T23:00:00Z');
    expect(buildTimeContext(now, KOLKATA)).toContain('tomorrow = 2026-10-10');
    const r = run(
      { due_kind: 'datetime', due_expression: 'tomorrow at 5pm', due_local: '2026-10-10T17:00' },
      KOLKATA,
      now,
    );
    expect(r.dueAt?.toISOString()).toBe('2026-10-10T11:30:00.000Z');
  });

  it('a date-only claim never gains a time of day', () => {
    const r = run({ due_kind: 'date', due_expression: 'Friday', due_local: '2026-10-09' }, KOLKATA);
    expect(r.dueHasTime).toBe(false);
    expect(r.dueAt?.toISOString()).toBe('2026-10-08T18:30:00.000Z'); // start of 9 Oct, Kolkata
  });

  it.each([
    ['hour 24', '2026-10-09T24:00'],
    ['minute 60', '2026-10-09T10:60'],
    ['a non-existent day', '2026-02-30T10:00'],
    ['a non-existent leap day', '2027-02-29'],
    ['an offset suffix', '2026-10-09T10:00+05:30'],
    ['a UTC suffix', '2026-10-09T10:00:00Z'],
    ['a word', 'tomorrow'],
  ])('drops a due date with %s instead of guessing', (_n, due_local) => {
    const r = run(
      { due_kind: due_local.includes('T') ? 'datetime' : 'date', due_expression: 'x1', due_local },
      KOLKATA,
      new Date('2026-10-08T10:00:00Z'),
    );
    expect(r).toEqual({ dueAt: null, dueHasTime: false });
  });

  it('accepts a leap day', () => {
    const r = run(
      { due_kind: 'date', due_expression: 'Feb 29', due_local: '2028-02-29' },
      'UTC',
      new Date('2028-02-01T00:00:00Z'),
    );
    expect(r.dueAt?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
});
