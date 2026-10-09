import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDue, isPast, toInputDate, toInputTime } from '../src/lib/time';

const NY = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';

/** Stored UTC instant -> what the user sees and what the edit form shows, in the ACCOUNT timezone. */
describe('UTC instant -> account timezone', () => {
  it('Asia/Kolkata: 11:30Z on 9 Oct is 17:00 that day (the 17:00 the user typed)', () => {
    const iso = '2026-10-09T11:30:00.000Z';
    expect(toInputDate(iso, KOLKATA)).toBe('2026-10-09');
    expect(toInputTime(iso, KOLKATA)).toBe('17:00');
    expect(formatDue(iso, true, KOLKATA)).toBe('Fri, 9 Oct 2026, 17:00');
  });

  it('crosses the calendar day in both directions', () => {
    // 18:30Z is already tomorrow in Kolkata, still today in New York.
    expect(toInputDate('2026-10-08T18:30:00.000Z', KOLKATA)).toBe('2026-10-09');
    expect(toInputTime('2026-10-08T18:30:00.000Z', KOLKATA)).toBe('00:00');
    expect(toInputDate('2026-10-10T03:59:00.000Z', NY)).toBe('2026-10-09');
    expect(toInputTime('2026-10-10T03:59:00.000Z', NY)).toBe('23:59');
  });

  it('midnight shows as 00:00, never 24:00', () => {
    expect(toInputTime('2026-10-08T18:30:00.000Z', KOLKATA)).toBe('00:00');
    expect(formatDue('2026-10-08T18:30:00.000Z', true, KOLKATA)).toBe('Fri, 9 Oct 2026, 00:00');
  });

  it('spring forward: the offset changes at 02:00 local', () => {
    expect(toInputTime('2026-03-08T06:59:00.000Z', NY)).toBe('01:59'); // EST
    expect(toInputTime('2026-03-08T07:00:00.000Z', NY)).toBe('03:00'); // EDT, 1 minute later
  });

  it('fall back: the 01:00 hour happens twice', () => {
    expect(toInputTime('2026-11-01T05:30:00.000Z', NY)).toBe('01:30'); // EDT, first time
    expect(toInputTime('2026-11-01T06:30:00.000Z', NY)).toBe('01:30'); // EST, second time
    expect(toInputTime('2026-11-01T07:00:00.000Z', NY)).toBe('02:00');
  });

  it('a date-only value shows only its date, with no time of day', () => {
    // Start of 9 Oct in Kolkata (reminder) and end of 9 Oct (todo).
    expect(formatDue('2026-10-08T18:30:00.000Z', false, KOLKATA)).toBe('Fri, 9 Oct 2026');
    expect(formatDue('2026-10-09T18:29:59.999Z', false, KOLKATA)).toBe('Fri, 9 Oct 2026');
  });

  it('a leap day formats as that day', () => {
    expect(formatDue('2028-02-29T12:00:00.000Z', false, 'UTC')).toBe('Tue, 29 Feb 2028');
  });
});

describe('formatDateTime (history and note timestamps)', () => {
  it('uses the account timezone, including DST', () => {
    expect(formatDateTime('2026-07-01T23:30:00.000Z', 'Europe/London')).toBe('2 Jul 2026, 00:30');
    expect(formatDateTime('2026-01-01T23:30:00.000Z', 'Europe/London')).toBe('1 Jan 2026, 23:30');
    expect(formatDateTime('2026-03-08T07:00:00.000Z', NY)).toBe('8 Mar 2026, 03:00');
  });
});

describe('isPast', () => {
  const now = new Date('2026-10-09T11:30:00.000Z');
  it('compares instants, so the timezone cannot change the answer', () => {
    expect(isPast('2026-10-09T11:29:59.999Z', now)).toBe(true);
    expect(isPast('2026-10-09T11:30:00.001Z', now)).toBe(false);
  });
  it('a date-only todo (end of local day) is overdue only after that day ends', () => {
    const endOfDayKolkata = '2026-10-09T18:29:59.999Z';
    expect(isPast(endOfDayKolkata, new Date('2026-10-09T18:29:59.000Z'))).toBe(false);
    expect(isPast(endOfDayKolkata, new Date('2026-10-09T18:30:00.000Z'))).toBe(true);
  });
});
