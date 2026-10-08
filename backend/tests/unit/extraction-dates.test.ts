import { describe, expect, it } from 'vitest';
import { buildTimeContext, resolveDue } from '../../src/ai/extraction/dates.js';
import {
  extractionJsonSchema,
  rawExtractionSchema,
  type RawItem,
} from '../../src/ai/extraction/schema.js';
import { item, reply } from '../helpers/fakeAi.js';

// Thursday 8 Oct 2026, 10:00 UTC
const NOW = new Date('2026-10-08T10:00:00Z');
const always = () => true;
const raw = (partial: Partial<RawItem>): RawItem => item(partial) as RawItem;

describe('buildTimeContext (user timezone, controlled clock)', () => {
  it('describes today/tomorrow and the weekday lookup in the user timezone', () => {
    const ctx = buildTimeContext(NOW, 'UTC');
    expect(ctx).toContain('2026-10-08 10:00 (Thursday)');
    expect(ctx).toContain('today = 2026-10-08');
    expect(ctx).toContain('tomorrow = 2026-10-09');
    expect(ctx).toContain('- Friday: 2026-10-09; next Friday: 2026-10-16');
    expect(ctx).toContain('- Monday: 2026-10-12; next Monday: 2026-10-12');
    expect(ctx).toContain('- Thursday: 2026-10-15; next Thursday: 2026-10-15');
    expect(ctx).toContain('- Sunday: 2026-10-11; next Sunday: 2026-10-18');
  });

  it('moves to the next local day when the user is ahead of UTC', () => {
    // 10:00 UTC is 15:30 in Kolkata (same day) but 22:30Z is already Friday there.
    const late = new Date('2026-10-08T22:30:00Z');
    const ctx = buildTimeContext(late, 'Asia/Kolkata');
    expect(ctx).toContain('2026-10-09 04:00 (Friday)');
    expect(ctx).toContain('today = 2026-10-09');
    expect(ctx).toContain('timezone Asia/Kolkata (UTC+05:30)');
  });

  it('stays on the previous local day when the user is behind UTC', () => {
    const early = new Date('2026-10-08T03:00:00Z');
    const ctx = buildTimeContext(early, 'America/Los_Angeles');
    expect(ctx).toContain('2026-10-07 20:00 (Wednesday)');
    expect(ctx).toContain('tomorrow = 2026-10-08');
  });

  it('on a Sunday, the following calendar week starts tomorrow', () => {
    const sunday = new Date('2026-10-11T12:00:00Z');
    const ctx = buildTimeContext(sunday, 'UTC');
    expect(ctx).toContain('- Friday: 2026-10-16; next Friday: 2026-10-16');
    expect(ctx).toContain('- Monday: 2026-10-12; next Monday: 2026-10-12');
  });
});

describe('resolveDue', () => {
  it('"tomorrow" (date only) keeps the fact that no time was given', () => {
    const r = resolveDue(
      raw({ due_kind: 'date', due_expression: 'tomorrow', due_local: '2026-10-09' }),
      {
        now: NOW,
        timezone: 'Asia/Kolkata',
        groundedIn: always,
      },
    );
    expect(r.dueHasTime).toBe(false);
    // start of 9 Oct in Kolkata = 8 Oct 18:30Z
    expect(r.dueAt?.toISOString()).toBe('2026-10-08T18:30:00.000Z');
  });

  it('"tomorrow at 5 PM" in the user timezone converts to UTC', () => {
    const r = resolveDue(
      raw({
        due_kind: 'datetime',
        due_expression: 'tomorrow at 5 PM',
        due_local: '2026-10-09T17:00',
      }),
      { now: NOW, timezone: 'Asia/Kolkata', groundedIn: always },
    );
    expect(r).toEqual({ dueAt: new Date('2026-10-09T11:30:00.000Z'), dueHasTime: true });
  });

  it('respects daylight-saving offsets (America/New_York)', () => {
    const at = (local: string) =>
      resolveDue(raw({ due_kind: 'datetime', due_expression: 'at 9am', due_local: local }), {
        now: NOW,
        timezone: 'America/New_York',
        groundedIn: always,
      }).dueAt?.toISOString();
    expect(at('2026-10-30T09:00')).toBe('2026-10-30T13:00:00.000Z'); // EDT, UTC-4
    expect(at('2026-11-02T09:00')).toBe('2026-11-02T14:00:00.000Z'); // EST, UTC-5
  });

  it('the same wall-clock time differs by timezone', () => {
    const run = (timezone: string) =>
      resolveDue(
        raw({ due_kind: 'datetime', due_expression: '17:00', due_local: '2026-10-09T17:00' }),
        {
          now: NOW,
          timezone,
          groundedIn: always,
        },
      ).dueAt?.toISOString();
    expect(run('UTC')).toBe('2026-10-09T17:00:00.000Z');
    expect(run('Europe/London')).toBe('2026-10-09T16:00:00.000Z');
    expect(run('Asia/Tokyo')).toBe('2026-10-09T08:00:00.000Z');
  });

  it('"in two hours" is computed from the clock, independent of timezone', () => {
    const r = resolveDue(
      raw({ due_kind: 'relative', due_expression: 'in two hours', due_relative_minutes: 120 }),
      { now: NOW, timezone: 'Asia/Tokyo', groundedIn: always },
    );
    expect(r).toEqual({ dueAt: new Date('2026-10-08T12:00:00.000Z'), dueHasTime: true });
  });

  it('downgrades a claimed time that the note never stated (ambiguous time -> date only)', () => {
    const r = resolveDue(
      raw({
        due_kind: 'datetime',
        due_expression: 'sometime tomorrow',
        due_local: '2026-10-09T09:00',
      }),
      { now: NOW, timezone: 'UTC', groundedIn: always },
    );
    expect(r.dueHasTime).toBe(false);
    expect(r.dueAt?.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it.each(['tomorrow morning', 'tomorrow evening', 'tonight', 'later today'])(
    'does not treat "%s" as a clock time',
    (expression) => {
      const r = resolveDue(
        raw({ due_kind: 'datetime', due_expression: expression, due_local: '2026-10-09T09:00' }),
        { now: NOW, timezone: 'UTC', groundedIn: always },
      );
      expect(r.dueHasTime).toBe(false);
    },
  );

  it('drops the date when the quoted wording is not in the note', () => {
    const r = resolveDue(
      raw({ due_kind: 'date', due_expression: 'next Friday', due_local: '2026-10-16' }),
      { now: NOW, timezone: 'UTC', groundedIn: () => false },
    );
    expect(r).toEqual({ dueAt: null, dueHasTime: false });
  });

  it.each([
    ['missing expression', { due_kind: 'date', due_expression: null, due_local: '2026-10-09' }],
    ['missing local value', { due_kind: 'date', due_expression: 'tomorrow', due_local: null }],
    ['malformed date', { due_kind: 'date', due_expression: 'tomorrow', due_local: 'tomorrow' }],
    ['impossible date', { due_kind: 'date', due_expression: 'x', due_local: '2026-02-31' }],
    [
      'impossible time',
      { due_kind: 'datetime', due_expression: '25:99', due_local: '2026-10-09T25:99' },
    ],
    [
      'date more than 5 years out',
      { due_kind: 'date', due_expression: 'x', due_local: '2040-01-01' },
    ],
    ['date long in the past', { due_kind: 'date', due_expression: 'x', due_local: '2019-01-01' }],
    [
      'relative without minutes',
      { due_kind: 'relative', due_expression: 'soon', due_relative_minutes: null },
    ],
    ['relative zero', { due_kind: 'relative', due_expression: 'x', due_relative_minutes: 0 }],
    ['relative negative', { due_kind: 'relative', due_expression: 'x', due_relative_minutes: -5 }],
    [
      'relative absurdly far',
      { due_kind: 'relative', due_expression: 'x', due_relative_minutes: 10_000_000 },
    ],
    ['kind none', { due_kind: 'none' }],
  ])('returns no due date for %s', (_name, partial) => {
    const r = resolveDue(raw(partial as Partial<RawItem>), {
      now: NOW,
      timezone: 'UTC',
      groundedIn: always,
    });
    expect(r).toEqual({ dueAt: null, dueHasTime: false });
  });

  it('accepts a date earlier today (a time that already passed is still legitimate)', () => {
    const r = resolveDue(
      raw({ due_kind: 'datetime', due_expression: 'today at 9am', due_local: '2026-10-08T09:00' }),
      { now: NOW, timezone: 'UTC', groundedIn: always },
    );
    expect(r.dueAt?.toISOString()).toBe('2026-10-08T09:00:00.000Z');
  });
});

describe('extraction schema', () => {
  it('Zod accepts a well-formed reply, including an empty one', () => {
    expect(rawExtractionSchema.safeParse(JSON.parse(reply())).success).toBe(true);
    expect(rawExtractionSchema.safeParse(JSON.parse(reply(item()))).success).toBe(true);
  });

  it.each([
    ['not an object', []],
    ['missing items', {}],
    ['items not an array', { items: 'none' }],
    ['unknown kind', { items: [{ ...item(), kind: 'event' }] }],
    ['missing field', { items: [{ ...item(), evidence: undefined }] }],
    ['wrong type', { items: [{ ...item(), text: 5 }] }],
    ['empty text', { items: [{ ...item(), text: '' }] }],
    ['unknown due kind', { items: [{ ...item(), due_kind: 'eventually' }] }],
    ['fractional minutes', { items: [{ ...item(), due_relative_minutes: 1.5 }] }],
  ])('Zod rejects %s', (_name, value) => {
    expect(rawExtractionSchema.safeParse(value).success).toBe(false);
  });

  it('the JSON Schema sent to the provider lists exactly the fields Zod validates', () => {
    const props = Object.keys(extractionJsonSchema.properties.items.items.properties).sort();
    const zodKeys = Object.keys(item()).sort();
    expect(props).toEqual(zodKeys);
    expect([...extractionJsonSchema.properties.items.items.required].sort()).toEqual(zodKeys);
  });
});
