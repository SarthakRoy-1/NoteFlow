import { describe, expect, it, vi } from 'vitest';
import {
  createGoogleCalendarApi,
  type CalendarEventInput,
} from '../../src/calendar/googleCalendar.js';
import { decryptToken, encryptToken } from '../../src/calendar/tokenCrypto.js';

const EVENT: CalendarEventInput = {
  eventId: 'abc123',
  summary: 'Send the invoice',
  description: 'Created by NoteFlow',
  start: new Date('2026-10-09T11:30:00Z'),
  end: new Date('2026-10-09T12:00:00Z'),
  timeZone: 'Asia/Kolkata',
  rrule: null,
  reminderId: 'r-1',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = () => json({ access_token: 'access-1' });

/** A scripted fetch: answers in order and records (url, method) of each call. */
function script(...answers: (Response | Error)[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body?.toString() });
    const next = answers.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const api = (fetchImpl: typeof fetch) =>
  createGoogleCalendarApi({ clientId: 'id', clientSecret: 'secret', fetchImpl });

describe('Google Calendar client', () => {
  it('refreshes an access token, then creates the event with our id', async () => {
    const s = script(token(), json({ id: 'abc123' }));
    const out = await api(s.fetchImpl).upsertEvent('refresh', EVENT);
    expect(out).toEqual({ ok: true, eventId: 'abc123' });
    expect(s.calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(s.calls[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(s.calls[1]?.body ?? '{}')).toMatchObject({
      id: 'abc123',
      summary: 'Send the invoice',
      start: { dateTime: '2026-10-09T11:30:00.000Z', timeZone: 'Asia/Kolkata' },
    });
  });

  it('turns an "already exists" answer into an update, never a duplicate', async () => {
    const s = script(token(), json({}, 409), json({ id: 'abc123' }));
    const out = await api(s.fetchImpl).upsertEvent('refresh', EVENT);
    expect(out.ok).toBe(true);
    expect(s.calls[2]).toMatchObject({ method: 'PATCH' });
    expect(s.calls[2]?.url).toContain('/events/abc123');
  });

  it.each([
    ['a revoked grant', json({ error: 'invalid_grant' }, 400), 'revoked'],
    ['a Google outage on the token call', json({}, 503), 'transient'],
    ['a rejected client', json({ error: 'invalid_client' }, 401), 'invalid'],
  ])('maps %s on the token call', async (_name, answer, failure) => {
    const out = await api(script(answer).fetchImpl).upsertEvent('refresh', EVENT);
    expect(out).toEqual({ ok: false, failure });
  });

  it.each([
    [json({}, 401), 'revoked'],
    [json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 403), 'no_permission'],
    [json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403), 'transient'],
    [json({}, 429), 'transient'],
    [json({}, 500), 'transient'],
    [json({}, 400), 'invalid'],
  ])('maps a Calendar API answer to %#', async (answer, failure) => {
    const out = await api(script(token(), answer).fetchImpl).upsertEvent('refresh', EVENT);
    expect(out).toEqual({ ok: false, failure });
  });

  it('treats a network failure as transient, never throwing', async () => {
    const out = await api(script(token(), new TypeError('socket')).fetchImpl).upsertEvent(
      'refresh',
      EVENT,
    );
    expect(out).toEqual({ ok: false, failure: 'transient' });
  });

  it('an event that is already gone counts as deleted', async () => {
    for (const status of [204, 404, 410]) {
      const s = script(token(), new Response(null, { status }));
      expect(await api(s.fetchImpl).deleteEvent('refresh', 'abc123')).toEqual({ ok: true });
    }
  });

  it('sends the recurrence rule for a repeating reminder', async () => {
    const s = script(token(), json({ id: 'abc123' }));
    await api(s.fetchImpl).upsertEvent('refresh', {
      ...EVENT,
      rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
    });
    expect(JSON.parse(s.calls[1]?.body ?? '{}').recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
  });

  it('revoke never throws', async () => {
    await expect(
      api(script(new TypeError('offline')).fetchImpl).revoke('refresh'),
    ).resolves.toBeUndefined();
  });
});

describe('token encryption', () => {
  it('round-trips, uses a fresh IV, and fails closed on tampering or a different secret', () => {
    const secret = 'a-test-session-secret-of-sufficient-length';
    const a = encryptToken('refresh-token', secret);
    const b = encryptToken('refresh-token', secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh-token');
    expect(decryptToken(a, secret)).toBe('refresh-token');
    expect(decryptToken(a, 'another-secret-another-secret-another')).toBeNull();
    expect(decryptToken(`${a.slice(0, -2)}xx`, secret)).toBeNull();
    expect(decryptToken('not.a.token', secret)).toBeNull();
    expect(decryptToken('', secret)).toBeNull();
  });
});
