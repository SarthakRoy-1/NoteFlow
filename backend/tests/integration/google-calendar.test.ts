import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { storeCalendarConnection } from '../../src/calendar/calendarSync.js';
import { decryptToken } from '../../src/calendar/tokenCrypto.js';
import { googleCalendarConnections, reminders } from '../../src/db/schema.js';
import { FakeAI, item, reply } from '../helpers/fakeAi.js';
import {
  FakeCalendarApi,
  FakeGoogle,
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const KOLKATA = 'Asia/Kolkata';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const env = testEnv();
const NOTE = { title: 'Invoice', content: 'Remind John to send the invoice on Friday at 5pm' };

const complete = (over: Record<string, unknown> = {}) =>
  item({
    kind: 'reminder',
    text: 'Send the invoice',
    person: 'John',
    evidence: 'remind john to send the invoice on friday at 5pm',
    due_kind: 'datetime',
    due_expression: 'Friday at 5pm',
    due_local: '2026-10-09T17:00',
    ...over,
  });

const incomplete = () =>
  item({
    kind: 'reminder',
    text: 'Send the invoice',
    person: 'John',
    evidence: 'remind john to send the invoice on friday at 5pm',
    due_kind: 'date',
    due_expression: 'Friday',
    due_local: '2026-10-09',
  });

function setup(opts: { calendarApi?: FakeCalendarApi | null } = {}) {
  const ai = new FakeAI();
  const google = new FakeGoogle();
  const calendar = opts.calendarApi === undefined ? new FakeCalendarApi() : opts.calendarApi;
  const app = buildApp(db, env, google, { ai, calendarApi: calendar });
  return { ai, google, calendar, app };
}
type Ctx = ReturnType<typeof setup>;

async function connected(ctx: Ctx, over: { timezone?: string } = {}) {
  const u = await createUserWithSession(db, { timezone: over.timezone ?? KOLKATA });
  await storeCalendarConnection(db, env.SESSION_SECRET, {
    userId: u.user.id,
    refreshToken: 'stored-refresh-token',
    scope: SCOPE,
    googleEmail: u.user.email,
  });
  return u;
}

async function saveNote(ctx: Ctx, cookie: string, ...items: ReturnType<typeof item>[]) {
  ctx.ai.respondWith(reply(...items));
  const res = await request(ctx.app).post('/api/notes').set('Cookie', cookie).send(NOTE);
  expect(res.status).toBe(201);
  return res.body.note as { id: string };
}

const reminderRows = () => db.select().from(reminders);

describe('connecting Google Calendar', () => {
  it('needs a signed-in user and reports the connection without any token', async () => {
    const ctx = setup();
    expect((await request(ctx.app).get('/api/calendar/status')).status).toBe(401);
    expect((await request(ctx.app).post('/api/calendar/connect')).status).toBe(401);
    expect((await request(ctx.app).post('/api/calendar/disconnect')).status).toBe(401);

    const u = await connected(ctx);
    const res = await request(ctx.app).get('/api/calendar/status').set('Cookie', u.cookie);
    expect(res.body).toEqual({
      available: true,
      connected: true,
      status: 'connected',
      googleEmail: u.user.email,
    });
    expect(JSON.stringify(res.body)).not.toContain('stored-refresh-token');
  });

  it('is unavailable (and says so) when the server has no calendar client', async () => {
    const ctx = setup({ calendarApi: null });
    const u = await createUserWithSession(db);
    const status = await request(ctx.app).get('/api/calendar/status').set('Cookie', u.cookie);
    expect(status.body).toMatchObject({ available: false, connected: false });
    const res = await request(ctx.app).post('/api/calendar/connect').set('Cookie', u.cookie);
    expect(res.status).toBe(503);
  });

  async function startConsent(ctx: Ctx, cookie: string) {
    const res = await request(ctx.app).post('/api/calendar/connect').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).map(
      (c) => c.split(';')[0],
    );
    const checks = ctx.google.calendarStarted.at(-1);
    if (!checks) throw new Error('consent was not started');
    return { url: res.body.url as string, cookies: [cookie, ...setCookie].join('; '), checks };
  }
  const callback = (ctx: Ctx, cookies: string, query: Record<string, string>) =>
    request(ctx.app).get('/api/auth/google/callback').query(query).set('Cookie', cookies);

  it('stores the grant encrypted, only for the signed-in user, and never exposes it', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { email: 'person@example.com' });
    const { url, cookies, checks } = await startConsent(ctx, u.cookie);
    expect(url).toContain('calendar-consent');

    const res = await callback(ctx, cookies, { state: checks.state, code: 'abc' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${env.APP_BASE_URL}/settings?calendar=connected`);

    const [row] = await db.select().from(googleCalendarConnections);
    expect(row).toMatchObject({
      userId: u.user.id,
      status: 'connected',
      scope: expect.any(String),
    });
    expect(row?.refreshTokenEnc).not.toContain('refresh-token-1');
    expect(decryptToken(row?.refreshTokenEnc ?? '', env.SESSION_SECRET)).toBe('refresh-token-1');
    // The consent cookie is single use.
    const cleared = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cleared).toMatch(/noteflow_calendar=[^;]*;[^]*Expires=Thu, 01 Jan 1970/);
  });

  it('treats a declined consent as "declined", connects nothing and does not sign anyone out', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const { cookies, checks } = await startConsent(ctx, u.cookie);
    const res = await callback(ctx, cookies, { state: checks.state, error: 'access_denied' });
    expect(res.headers.location).toBe(`${env.APP_BASE_URL}/settings?calendar=declined`);
    expect(await db.select().from(googleCalendarConnections)).toHaveLength(0);
    // Still signed in.
    expect((await request(ctx.app).get('/api/me').set('Cookie', u.cookie)).status).toBe(200);
  });

  it('refuses a grant that does not include Calendar access (the box was unticked)', async () => {
    const ctx = setup();
    ctx.google.calendarGrant = { ...ctx.google.calendarGrant, scope: 'openid email' };
    const u = await createUserWithSession(db, { email: 'person@example.com' });
    const { cookies, checks } = await startConsent(ctx, u.cookie);
    const res = await callback(ctx, cookies, { state: checks.state, code: 'abc' });
    expect(res.headers.location).toBe(`${env.APP_BASE_URL}/settings?calendar=declined`);
    expect(await db.select().from(googleCalendarConnections)).toHaveLength(0);
  });

  it('refuses a grant from a different Google account', async () => {
    const ctx = setup();
    ctx.google.calendarGrant = { ...ctx.google.calendarGrant, email: 'someone.else@example.com' };
    const u = await createUserWithSession(db, { email: 'person@example.com' });
    const { cookies, checks } = await startConsent(ctx, u.cookie);
    const res = await callback(ctx, cookies, { state: checks.state, code: 'abc' });
    expect(res.headers.location).toBe(`${env.APP_BASE_URL}/settings?calendar=mismatch`);
    expect(await db.select().from(googleCalendarConnections)).toHaveLength(0);
  });

  it('needs a refresh token, and a failing exchange is a controlled error', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { email: 'person@example.com' });

    ctx.google.calendarGrant = { ...ctx.google.calendarGrant, refreshToken: null };
    let started = await startConsent(ctx, u.cookie);
    let res = await callback(ctx, started.cookies, { state: started.checks.state, code: 'abc' });
    expect(res.headers.location).toBe(`${env.APP_BASE_URL}/settings?calendar=error`);

    ctx.google.calendarFailWith = new Error('boom');
    started = await startConsent(ctx, u.cookie);
    res = await callback(ctx, started.cookies, { state: started.checks.state, code: 'abc' });
    expect(res.headers.location).toBe(`${env.APP_BASE_URL}/settings?calendar=error`);
    expect(await db.select().from(googleCalendarConnections)).toHaveLength(0);
  });

  it('a consent started by one user cannot be finished under another session', async () => {
    const ctx = setup();
    const a = await createUserWithSession(db, { email: 'person@example.com' });
    const b = await createUserWithSession(db, { email: 'other@example.com' });
    const { cookies, checks } = await startConsent(ctx, a.cookie);
    // The same consent cookie, but arriving with B's session.
    const forged = cookies.replace(a.cookie, b.cookie);
    const res = await callback(ctx, forged, { state: checks.state, code: 'abc' });
    expect(res.headers.location).toBe(`${env.APP_BASE_URL}/settings?calendar=error`);
    expect(await db.select().from(googleCalendarConnections)).toHaveLength(0);
  });

  it('ignores a calendar callback with the wrong state', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { email: 'person@example.com' });
    const { cookies } = await startConsent(ctx, u.cookie);
    const res = await callback(ctx, cookies, { state: 'not-the-state', code: 'abc' });
    expect(res.headers.location).toContain('error=invalid_state');
    expect(await db.select().from(googleCalendarConnections)).toHaveLength(0);
  });

  it('disconnecting removes the connection, asks Google to revoke it, and clears event links', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await saveNote(ctx, u.cookie, complete());
    expect((await reminderRows())[0]?.googleEventId).toBeTruthy();

    const res = await request(ctx.app).post('/api/calendar/disconnect').set('Cookie', u.cookie);
    expect(res.status).toBe(204);
    expect(await db.select().from(googleCalendarConnections)).toHaveLength(0);
    expect(ctx.calendar?.revoked).toEqual(['stored-refresh-token']);
    expect((await reminderRows())[0]?.googleEventId).toBeNull();
  });
});

describe('putting reminders in the calendar', () => {
  it('creates one event for a saved reminder, at the right instant and zone', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await saveNote(ctx, u.cookie, complete());

    const [row] = await reminderRows();
    expect(ctx.calendar?.upserts).toHaveLength(1);
    const [event] = ctx.calendar?.upserts ?? [];
    expect(event).toMatchObject({
      eventId: row?.id.replaceAll('-', ''),
      summary: 'Send the invoice (for John)',
      timeZone: KOLKATA,
      rrule: null,
    });
    expect(event?.start.toISOString()).toBe('2026-10-09T11:30:00.000Z'); // 17:00 IST
    expect((event?.end.getTime() ?? 0) - (event?.start.getTime() ?? 0)).toBe(30 * 60_000);
    expect(row).toMatchObject({ googleEventId: event?.eventId });
    // No note text or token in what is sent to Google.
    expect(JSON.stringify(event)).not.toContain(NOTE.content);
  });

  it('does nothing for a user who has not connected', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await saveNote(ctx, u.cookie, complete());
    expect(ctx.calendar?.upserts).toHaveLength(0);
    expect((await reminderRows())[0]?.googleEventId).toBeNull();
  });

  it('creates no event for an incomplete reminder', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await saveNote(ctx, u.cookie, incomplete());
    expect(ctx.calendar?.upserts).toHaveLength(0);
    expect(await reminderRows()).toHaveLength(0);
  });

  it('creates the event only once the pending reminder has been completed and saved', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await saveNote(ctx, u.cookie, incomplete());
    expect(ctx.calendar?.upserts).toHaveLength(0);

    const [draft] = (await request(ctx.app).get('/api/reminder-drafts').set('Cookie', u.cookie))
      .body.drafts;
    // A rejected completion creates no event.
    const bad = await request(ctx.app)
      .post(`/api/reminder-drafts/${draft.id}/complete`)
      .set('Cookie', u.cookie)
      .send({ date: '2026-10-09' });
    expect(bad.status).toBe(422);
    expect(ctx.calendar?.upserts).toHaveLength(0);

    const ok = await request(ctx.app)
      .post(`/api/reminder-drafts/${draft.id}/complete`)
      .set('Cookie', u.cookie)
      .send({ date: '2026-10-09', time: '17:00' });
    expect(ok.status).toBe(201);
    expect(ctx.calendar?.upserts).toHaveLength(1);
    expect(ctx.calendar?.upserts[0]?.start.toISOString()).toBe('2026-10-09T11:30:00.000Z');
  });

  it('updates the same event when the reminder is edited, never a second one', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await saveNote(ctx, u.cookie, complete());
    const [row] = await reminderRows();

    const res = await request(ctx.app)
      .patch(`/api/reminders/${row?.id}`)
      .set('Cookie', u.cookie)
      .send({ due: { date: '2026-10-10', time: '09:15' }, text: 'Send it' });
    expect(res.status).toBe(200);

    expect(ctx.calendar?.upserts).toHaveLength(2);
    const ids = new Set(ctx.calendar?.upserts.map((e) => e.eventId));
    expect(ids.size).toBe(1);
    expect(ctx.calendar?.events.size).toBe(1);
    const last = ctx.calendar?.upserts.at(-1);
    expect(last?.summary).toBe('Send it (for John)');
    expect(last?.start.toISOString()).toBe('2026-10-10T03:45:00.000Z');
  });

  it('does not touch the calendar when nothing about the reminder changed', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    const note = await saveNote(ctx, u.cookie, complete());
    expect(ctx.calendar?.upserts).toHaveLength(1);

    ctx.ai.respondWith(reply(complete()));
    await request(ctx.app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: `${NOTE.content} please` });
    expect(ctx.calendar?.upserts).toHaveLength(1);
  });

  it('removes the event when the reminder or its note is deleted', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    const note = await saveNote(ctx, u.cookie, complete());
    const [row] = await reminderRows();
    const eventId = row?.googleEventId;

    await request(ctx.app).delete(`/api/reminders/${row?.id}`).set('Cookie', u.cookie);
    expect(ctx.calendar?.deletes).toEqual([eventId]);

    // And through the note (its reminders go with it).
    ctx.ai.respondWith(reply(complete({ text: 'Another thing' })));
    const second = await request(ctx.app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Second', content: NOTE.content });
    const [r2] = await reminderRows();
    await request(ctx.app).delete(`/api/notes/${second.body.note.id}`).set('Cookie', u.cookie);
    expect(ctx.calendar?.deletes).toContain(r2?.googleEventId);
    expect(note.id).toBeTruthy();
  });

  it('a repeating reminder becomes a weekly recurring event', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    ctx.ai.respondWith(
      reply(
        item({
          kind: 'reminder',
          text: 'Send the report',
          evidence: 'send the report every friday at 5pm',
          due_kind: 'datetime',
          due_expression: 'every Friday at 5pm',
          due_local: '2026-10-09T17:00',
          recurrence_kind: 'weekly',
          recurrence_weekdays: [5],
          recurrence_expression: 'every Friday',
        }),
      ),
    );
    await request(ctx.app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Weekly', content: 'Send the report every Friday at 5pm' });
    const [event] = ctx.calendar?.upserts ?? [];
    expect(event?.rrule).toBe('RRULE:FREQ=WEEKLY;BYDAY=FR');
  });
});

describe('when Google Calendar fails', () => {
  it('a temporary failure never stops the reminder being saved, and is retried on the next edit', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    ctx.calendar!.failWith = 'transient';
    const note = await saveNote(ctx, u.cookie, complete());
    expect(note.id).toBeTruthy();

    const [row] = await reminderRows();
    expect(row).toMatchObject({ dueHasTime: true, googleEventId: null });
    const status = await request(ctx.app).get('/api/calendar/status').set('Cookie', u.cookie);
    expect(status.body.status).toBe('connected'); // a blip is not a revocation

    ctx.calendar!.failWith = undefined;
    const res = await request(ctx.app)
      .patch(`/api/reminders/${row?.id}`)
      .set('Cookie', u.cookie)
      .send({ text: 'Send the invoice today' });
    expect(res.status).toBe(200);
    expect((await reminderRows())[0]?.googleEventId).toBeTruthy();
  });

  it('revoked access marks the connection for reconnection and stops further calls', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    ctx.calendar!.failWith = 'revoked';
    await saveNote(ctx, u.cookie, complete());
    expect(await reminderRows()).toHaveLength(1); // still saved

    const status = await request(ctx.app).get('/api/calendar/status').set('Cookie', u.cookie);
    expect(status.body).toMatchObject({ connected: false, status: 'needs_reconnect' });

    const before = ctx.calendar!.upserts.length;
    const [row] = await reminderRows();
    await request(ctx.app)
      .patch(`/api/reminders/${row?.id}`)
      .set('Cookie', u.cookie)
      .send({ text: 'Edited' });
    expect(ctx.calendar!.upserts.length).toBe(before); // no calls while it needs reconnecting
  });

  it('a missing permission is handled the same way as revoked access', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    ctx.calendar!.failWith = 'no_permission';
    await saveNote(ctx, u.cookie, complete());
    const status = await request(ctx.app).get('/api/calendar/status').set('Cookie', u.cookie);
    expect(status.body.status).toBe('needs_reconnect');
  });

  it('a failed delete never blocks deleting the reminder', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await saveNote(ctx, u.cookie, complete());
    const [row] = await reminderRows();
    ctx.calendar!.failDeleteWith = 'transient';
    const res = await request(ctx.app).delete(`/api/reminders/${row?.id}`).set('Cookie', u.cookie);
    expect(res.status).toBe(204);
    expect(await reminderRows()).toHaveLength(0);
  });

  it("another user's connection is never used for my reminder", async () => {
    const ctx = setup();
    await connected(ctx); // someone else is connected
    const me = await createUserWithSession(db, { email: 'me@example.com', timezone: KOLKATA });
    await saveNote(ctx, me.cookie, complete());
    expect(ctx.calendar?.upserts).toHaveLength(0);
    const rows = await db.select().from(reminders).where(eq(reminders.userId, me.user.id));
    expect(rows[0]?.googleEventId).toBeNull();
  });
});

describe('syncing reminders that existed before connecting', () => {
  const IN_A_WEEK = new Date('2026-10-15T09:00:00Z');

  /** A real note owned by the user, and reminders inserted straight into the table. */
  async function seed(
    ctx: Ctx,
    u: Awaited<ReturnType<typeof createUserWithSession>>,
    rows: Partial<typeof reminders.$inferInsert>[],
  ) {
    ctx.ai.respondWith(reply());
    const res = await request(ctx.app).post('/api/notes').set('Cookie', u.cookie).send(NOTE);
    const noteId = (res.body.note as { id: string }).id;
    for (const [i, over] of rows.entries()) {
      await db.insert(reminders).values({
        userId: u.user.id,
        sourceNoteId: noteId,
        content: `Reminder ${i}`,
        dueAt: new Date(IN_A_WEEK.getTime() + i * 3_600_000),
        dueHasTime: true,
        ...over,
      });
    }
    return noteId;
  }

  const sync = (ctx: Ctx, cookie: string) =>
    request(ctx.app).post('/api/calendar/sync').set('Cookie', cookie);

  async function connectLater(u: Awaited<ReturnType<typeof createUserWithSession>>) {
    await storeCalendarConnection(db, env.SESSION_SECRET, {
      userId: u.user.id,
      refreshToken: 'stored-refresh-token',
      scope: SCOPE,
      googleEmail: u.user.email,
    });
  }

  it('needs a signed-in user', async () => {
    const ctx = setup();
    const res = await request(ctx.app).post('/api/calendar/sync');
    expect(res.status).toBe(401);
  });

  it('sends existing complete reminders once, and a repeat creates nothing new', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await seed(ctx, u, [{}, {}]);
    expect(ctx.calendar?.upserts).toHaveLength(0); // not connected yet: nothing was sent
    await connectLater(u);

    const first = await sync(ctx, u.cookie);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ result: 'ok', synced: 2, failed: 0, remaining: 0 });
    expect(ctx.calendar?.upserts).toHaveLength(2);
    for (const r of await reminderRows()) {
      expect(r.googleEventId).toBe(r.id.replaceAll('-', ''));
      expect(r.calendarSyncedAt).not.toBeNull();
    }

    const again = await sync(ctx, u.cookie);
    expect(again.body).toEqual({ result: 'ok', synced: 0, failed: 0, remaining: 0 });
    expect(ctx.calendar?.upserts).toHaveLength(2); // idempotent: no second call, no second event
    expect(ctx.calendar?.events.size).toBe(2);
  });

  it('skips what is not a calendar-ready reminder: drafts, no time, past, handled', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    ctx.ai.respondWith(reply(incomplete())); // a pending draft, not a reminder
    await request(ctx.app).post('/api/notes').set('Cookie', u.cookie).send(NOTE);
    expect(await reminderRows()).toHaveLength(0);
    const past = new Date('2026-10-01T09:00:00Z');
    await seed(ctx, u, [
      { content: 'Ready' },
      { content: 'No time', dueHasTime: false },
      { content: 'Past one-off', dueAt: past },
      { content: 'Done', status: 'acknowledged' },
      { content: 'Weekly past', dueAt: past, recurrenceDays: [1], recurrenceTime: '09:00' },
    ]);

    const res = await sync(ctx, u.cookie);
    expect(res.body).toMatchObject({ result: 'ok', synced: 2, failed: 0, remaining: 0 });
    const sent = (ctx.calendar?.upserts ?? []).map((e) => e.summary).sort();
    expect(sent).toEqual(['Ready', 'Weekly past']);
  });

  it('keeps saved reminders and reports a partial failure, then finishes on the next press', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await seed(ctx, u, [{ content: 'Fine' }, { content: 'Flaky' }, { content: 'Also fine' }]);
    ctx.calendar!.failSummaries.add('Flaky');

    const first = await sync(ctx, u.cookie);
    expect(first.body).toEqual({ result: 'ok', synced: 2, failed: 1, remaining: 1 });
    expect(await reminderRows()).toHaveLength(3); // nothing lost
    const flaky = (await reminderRows()).find((r) => r.content === 'Flaky');
    expect(flaky?.googleEventId).toBeNull();

    ctx.calendar!.failSummaries.clear();
    const second = await sync(ctx, u.cookie);
    expect(second.body).toEqual({ result: 'ok', synced: 1, failed: 0, remaining: 0 });
    // Only the one that failed was sent again.
    expect(ctx.calendar?.upserts.filter((e) => e.summary === 'Fine')).toHaveLength(1);
  });

  it('stops and asks to reconnect when Google refuses the permission', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await seed(ctx, u, [{}, {}, {}]);
    ctx.calendar!.failWith = 'no_permission';

    const res = await sync(ctx, u.cookie);
    expect(res.body).toMatchObject({ result: 'needs_reconnect', synced: 0 });
    expect(ctx.calendar?.upserts).toHaveLength(1); // stopped at the first refusal
    expect(await reminderRows()).toHaveLength(3);

    const later = await sync(ctx, u.cookie);
    expect(later.body.result).toBe('needs_reconnect');
    expect(ctx.calendar?.upserts).toHaveLength(1); // no calls while it needs reconnecting
  });

  it('does nothing for a user who is not connected', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await seed(ctx, u, [{}]);
    const res = await sync(ctx, u.cookie);
    expect(res.body).toEqual({ result: 'not_connected', synced: 0, failed: 0, remaining: 0 });
    expect(ctx.calendar?.upserts).toHaveLength(0);
  });

  it("never sends another user's reminders", async () => {
    const ctx = setup();
    const mine = await connected(ctx);
    const other = await createUserWithSession(db, {
      email: 'other@example.com',
      timezone: KOLKATA,
    });
    await connectLater(other);
    await seed(ctx, mine, [{ content: 'Mine' }]);
    await seed(ctx, other, [{ content: 'Theirs' }]);

    const res = await sync(ctx, mine.cookie);
    expect(res.body).toMatchObject({ synced: 1, remaining: 0 });
    expect((ctx.calendar?.upserts ?? []).map((e) => e.summary)).toEqual(['Mine']);
    const theirs = (await reminderRows()).find((r) => r.content === 'Theirs');
    expect(theirs?.googleEventId).toBeNull();
  });

  it('sends one batch at a time and says how many are left', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await seed(
      ctx,
      u,
      Array.from({ length: 27 }, () => ({})),
    );

    const first = await sync(ctx, u.cookie);
    expect(first.body).toEqual({ result: 'ok', synced: 25, failed: 0, remaining: 2 });
    const second = await sync(ctx, u.cookie);
    expect(second.body).toEqual({ result: 'ok', synced: 2, failed: 0, remaining: 0 });
    expect(ctx.calendar?.events.size).toBe(27);
  });

  it('changing the time zone marks sent events stale; a sync re-sends them in the new zone', async () => {
    const ctx = setup();
    const u = await connected(ctx);
    await seed(ctx, u, [{}]);
    await sync(ctx, u.cookie);
    expect(ctx.calendar?.upserts.at(-1)?.timeZone).toBe(KOLKATA);

    const res = await request(ctx.app)
      .patch('/api/me')
      .set('Cookie', u.cookie)
      .send({ timezone: 'Europe/London' });
    expect(res.status).toBe(200);
    expect((await reminderRows())[0]?.calendarSyncedAt).toBeNull();
    expect(ctx.calendar?.upserts).toHaveLength(1); // saving the zone sends nothing by itself

    const synced = await sync(ctx, u.cookie);
    expect(synced.body).toMatchObject({ synced: 1, remaining: 0 });
    expect(ctx.calendar?.upserts.at(-1)?.timeZone).toBe('Europe/London');
    expect(ctx.calendar?.events.size).toBe(1); // updated in place
  });
});
