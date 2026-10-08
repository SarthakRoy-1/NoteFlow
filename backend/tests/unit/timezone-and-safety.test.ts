import { describe, expect, it } from 'vitest';
import { isValidIanaTimezone } from '../../src/lib/timezone.js';
import { assertSafeTestDatabase } from '../helpers/safety.js';

describe('isValidIanaTimezone', () => {
  it.each(['UTC', 'Europe/London', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata'])(
    'accepts %s',
    (z) => expect(isValidIanaTimezone(z)).toBe(true),
  );
  it.each(['', 'EST', 'GMT+5', 'Mars/Olympus', '+05:30', 'europe london', 'Europe/'])(
    'rejects %j',
    (z) => expect(isValidIanaTimezone(z)).toBe(false),
  );
});

describe('assertSafeTestDatabase', () => {
  const dev = 'postgres://u:p@localhost:5432/noteflow';
  it('requires TEST_DATABASE_URL', () => {
    expect(() => assertSafeTestDatabase(undefined, dev)).toThrow(/TEST_DATABASE_URL is not set/);
  });
  it('requires a *_test database name', () => {
    expect(() => assertSafeTestDatabase('postgres://u:p@localhost:5432/noteflow', dev)).toThrow(
      /_test/,
    );
  });
  it('refuses the dev database even if it were named *_test', () => {
    const same = 'postgres://u:p@localhost:5432/x_test';
    expect(() => assertSafeTestDatabase(same, same)).toThrow(/same database/);
  });
  it('accepts a separate *_test database', () => {
    const r = assertSafeTestDatabase('postgres://u:p@localhost:5432/noteflow_test', dev);
    expect(r.dbName).toBe('noteflow_test');
  });
});
