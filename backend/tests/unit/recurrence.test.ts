import { describe, expect, it } from 'vitest';
import {
  localTimeOf,
  localWeekdayOf,
  nextOccurrence,
  normalizeDays,
  previousOccurrence,
  ruleFromRow,
  sameRule,
  type Recurrence,
} from '../../src/lib/recurrence.js';

const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);

const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';
const LONDON = 'Europe/London';

describe('normalizeDays', () => {
  it('sorts and de-duplicates', () => {
    expect(normalizeDays([5, 1, 5, 3])).toEqual([1, 3, 5]);
  });

  it.each([[[]], [[0]], [[8]], [[1.5]], [[-1]], [null], [undefined]])('rejects %j', (value) => {
    expect(normalizeDays(value as number[] | null | undefined)).toBeNull();
  });
});

describe('nextOccurrence', () => {
  const monday9: Recurrence = { days: [1], time: '09:00' };

  it('finds the next Monday 09:00 in the user timezone', () => {
    // Saturday 10 Oct 2026, 10:00 IST.
    expect(iso(nextOccurrence(monday9, at('2026-10-10T04:30:00Z'), KOLKATA))).toBe(
      '2026-10-12T03:30:00.000Z',
    );
  });

  it('uses today when the time has not passed yet, and is strictly after "after"', () => {
    expect(iso(nextOccurrence(monday9, at('2026-10-12T02:30:00Z'), KOLKATA))).toBe(
      '2026-10-12T03:30:00.000Z',
    );
    // Exactly at the occurrence: the NEXT one, a week later (no duplicate occurrence).
    expect(iso(nextOccurrence(monday9, at('2026-10-12T03:30:00Z'), KOLKATA))).toBe(
      '2026-10-19T03:30:00.000Z',
    );
  });

  it('skips the weekend for a weekday schedule', () => {
    const weekdays: Recurrence = { days: [1, 2, 3, 4, 5], time: '09:00' };
    // Friday 16 Oct 2026, 10:00 IST -> Monday 19 Oct 09:00 IST.
    expect(iso(nextOccurrence(weekdays, at('2026-10-16T04:30:00Z'), KOLKATA))).toBe(
      '2026-10-19T03:30:00.000Z',
    );
  });

  it('handles several days of the week', () => {
    const monWed: Recurrence = { days: [1, 3], time: '09:00' };
    // Tuesday 13 Oct 2026, 12:00 IST -> Wednesday 14 Oct 09:00 IST.
    expect(iso(nextOccurrence(monWed, at('2026-10-13T06:30:00Z'), KOLKATA))).toBe(
      '2026-10-14T03:30:00.000Z',
    );
  });

  it('with no time, repeats at the start of the local day', () => {
    const daily: Recurrence = { days: [1, 2, 3, 4, 5, 6, 7], time: null };
    // Saturday 10:00 IST -> Sunday 00:00 IST (= Saturday 18:30Z).
    expect(iso(nextOccurrence(daily, at('2026-10-10T04:30:00Z'), KOLKATA))).toBe(
      '2026-10-10T18:30:00.000Z',
    );
  });

  it('interprets the rule in the given timezone, not the server timezone', () => {
    const daily9: Recurrence = { days: [1, 2, 3, 4, 5, 6, 7], time: '09:00' };
    // Same instant, two zones, two different next occurrences.
    const now = at('2026-10-10T04:00:00Z');
    // 04:00Z is 09:30 in Kolkata (today's 09:00 has passed) and 00:00 in New York (not yet).
    expect(iso(nextOccurrence(daily9, now, KOLKATA))).toBe('2026-10-11T03:30:00.000Z');
    expect(iso(nextOccurrence(daily9, now, NEW_YORK))).toBe('2026-10-10T13:00:00.000Z');
  });

  it('keeps the same wall-clock time across the spring-forward change (New York)', () => {
    const rule: Recurrence = { days: [1], time: '09:00' };
    // Monday 2 Mar 09:00 EST (14:00Z) -> Monday 9 Mar 09:00 EDT (13:00Z): DST began on Sunday 8 Mar.
    const next = nextOccurrence(rule, at('2026-03-02T14:00:00Z'), NEW_YORK);
    expect(iso(next)).toBe('2026-03-09T13:00:00.000Z');
    expect(localTimeOf(next, NEW_YORK)).toBe('09:00');
  });

  it('keeps the same wall-clock time across the fall-back change (New York)', () => {
    const rule: Recurrence = { days: [1], time: '09:00' };
    // Monday 26 Oct 09:00 EDT (13:00Z) -> Monday 2 Nov 09:00 EST (14:00Z): DST ended on Sunday 1 Nov.
    const next = nextOccurrence(rule, at('2026-10-26T13:00:00Z'), NEW_YORK);
    expect(iso(next)).toBe('2026-11-02T14:00:00.000Z');
    expect(localTimeOf(next, NEW_YORK)).toBe('09:00');
  });

  it('keeps the wall-clock time across both UK changes (London)', () => {
    const rule: Recurrence = { days: [1], time: '09:00' };
    // BST ends Sunday 25 Oct 2026: Monday 19 Oct 09:00 BST (08:00Z) -> Monday 26 Oct 09:00 GMT (09:00Z).
    expect(iso(nextOccurrence(rule, at('2026-10-19T08:00:00Z'), LONDON))).toBe(
      '2026-10-26T09:00:00.000Z',
    );
    // BST starts Sunday 29 Mar 2026: Monday 23 Mar 09:00 GMT (09:00Z) -> Monday 30 Mar 09:00 BST (08:00Z).
    expect(iso(nextOccurrence(rule, at('2026-03-23T09:00:00Z'), LONDON))).toBe(
      '2026-03-30T08:00:00.000Z',
    );
  });

  it('moves a wall time that does not exist (spring-forward gap) to a valid later time', () => {
    const rule: Recurrence = { days: [1, 2, 3, 4, 5, 6, 7], time: '02:30' };
    // Saturday 7 Mar 2026 07:00 EST. 02:30 does not exist on Sunday 8 Mar in New York.
    const gapDay = nextOccurrence(rule, at('2026-03-07T12:00:00Z'), NEW_YORK);
    expect(gapDay.getTime()).toBeGreaterThan(at('2026-03-07T12:00:00Z').getTime());
    expect(localTimeOf(gapDay, NEW_YORK)).toBe('03:30');
    // The day after is back to the normal 02:30.
    const after = nextOccurrence(rule, gapDay, NEW_YORK);
    expect(localTimeOf(after, NEW_YORK)).toBe('02:30');
    expect(iso(after)).toBe('2026-03-09T06:30:00.000Z');
  });

  it('fires once on the day a wall time happens twice (fall-back overlap)', () => {
    const rule: Recurrence = { days: [1, 2, 3, 4, 5, 6, 7], time: '01:30' };
    // Sunday 1 Nov 2026: 01:30 happens as EDT (05:30Z) and again as EST (06:30Z).
    const first = nextOccurrence(rule, at('2026-11-01T04:00:00Z'), NEW_YORK);
    expect(iso(first)).toBe('2026-11-01T05:30:00.000Z');
    const second = nextOccurrence(rule, first, NEW_YORK);
    expect(iso(second)).toBe('2026-11-02T06:30:00.000Z'); // next day, not the repeated 01:30
  });

  it('always moves forward: 60 consecutive occurrences are strictly increasing', () => {
    const rule: Recurrence = { days: [1, 3, 5], time: '17:45' };
    let current = at('2026-01-01T00:00:00Z');
    for (let i = 0; i < 60; i++) {
      const next = nextOccurrence(rule, current, NEW_YORK);
      expect(next.getTime()).toBeGreaterThan(current.getTime());
      expect([1, 3, 5]).toContain(localWeekdayOf(next, NEW_YORK));
      expect(localTimeOf(next, NEW_YORK)).toBe('17:45');
      current = next;
    }
  });

  it('refuses an empty or invalid rule instead of looping or guessing', () => {
    expect(() => nextOccurrence({ days: [], time: null }, new Date(), 'UTC')).toThrow();
    expect(() => nextOccurrence({ days: [9], time: null }, new Date(), 'UTC')).toThrow();
    expect(() => nextOccurrence({ days: [1], time: '25:00' }, new Date(), 'UTC')).toThrow();
  });
});

describe('previousOccurrence', () => {
  const monday9: Recurrence = { days: [1], time: '09:00' };

  it('is the most recent occurrence at or before the instant', () => {
    // Wednesday 14 Oct 2026 -> Monday 12 Oct 09:00 IST.
    expect(iso(previousOccurrence(monday9, at('2026-10-14T06:30:00Z'), KOLKATA) as Date)).toBe(
      '2026-10-12T03:30:00.000Z',
    );
    // Exactly on the occurrence counts as that occurrence.
    expect(iso(previousOccurrence(monday9, at('2026-10-12T03:30:00Z'), KOLKATA) as Date)).toBe(
      '2026-10-12T03:30:00.000Z',
    );
    // One minute earlier: the previous week's.
    expect(iso(previousOccurrence(monday9, at('2026-10-12T03:29:00Z'), KOLKATA) as Date)).toBe(
      '2026-10-05T03:30:00.000Z',
    );
  });

  it('returns null for an invalid rule', () => {
    expect(previousOccurrence({ days: [], time: null }, new Date(), 'UTC')).toBeNull();
  });
});

describe('rule helpers', () => {
  it('ruleFromRow ignores a row without days', () => {
    expect(ruleFromRow({ recurrenceDays: null, recurrenceTime: null })).toBeNull();
    expect(ruleFromRow({ recurrenceDays: [3, 1], recurrenceTime: '09:00' })).toEqual({
      days: [1, 3],
      time: '09:00',
    });
  });

  it('sameRule compares days and time', () => {
    expect(sameRule(null, null)).toBe(true);
    expect(sameRule({ days: [1], time: '09:00' }, null)).toBe(false);
    expect(sameRule({ days: [1], time: '09:00' }, { days: [1], time: '09:00' })).toBe(true);
    expect(sameRule({ days: [1], time: '09:00' }, { days: [1], time: null })).toBe(false);
    expect(sameRule({ days: [1], time: null }, { days: [1, 2], time: null })).toBe(false);
  });
});
