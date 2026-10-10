import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notes, reminders } from '../../src/db/schema.js';
import { FakeAI, item, reply } from '../helpers/fakeAi.js';
import {
  FIXED_NOW,
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

/** FIXED_NOW is Thursday 8 Oct 2026 10:00 UTC = 15:30 in Kolkata. */
const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';
const MONDAY_9AM_IST = '2026-10-12T03:30:00.000Z';
const NEXT_MONDAY_9AM_IST = '2026-10-19T03:30:00.000Z';

const weeklyMonday = (overrides: Record<string, unknown> = {}) =>
  item({
    kind: 'reminder',
    text: 'Send the report',
    evidence: 'send the report every monday at 9am',
    due_kind: 'datetime',
    due_expression: 'every Monday at 9am',
    due_local: '2026-10-12T09:00',
    recurrence_kind: 'weekly',
    recurrence_weekdays: [1],
    recurrence_expression: 'every Monday',
    ...overrides,
  });

const NOTE = { title: 'Weekly', content: 'Remind me to send the report every Monday at 9am' };

function setup() {
  const ai = new FakeAI();
  const clock = { at: FIXED_NOW };
  const build = () => buildApp(db, testEnv(), undefined, { ai, now: () => clock.at });
  return { ai, clock, app: build(), build };
}

type Ctx = ReturnType<typeof setup>;

async function createRecurring(ctx: Ctx, cookie: string) {
  ctx.ai.respondWith(reply(weeklyMonday()));
  const res = await request(ctx.app).post('/api/notes').set('Cookie', cookie).send(NOTE);
  expect(res.status).toBe(201);
  const list = await request(ctx.app).get('/api/reminders').set('Cookie', cookie);
  expect(list.body.reminders).toHaveLength(1);
  return { noteId: res.body.note.id as string, reminder: list.body.reminders[0] };
}

const due = (ctx: Ctx, cookie: string) =>
  request(ctx.app).get('/api/reminders/due').set('Cookie', cookie);
const ack = (ctx: Ctx, cookie: string, id: string, acknowledged = true) =>
  request(ctx.app).patch(`/api/reminders/${id}`).set('Cookie', cookie).send({ acknowledged });

describe('creating a repeating reminder from a note', () => {
  it('stores the schedule and the next occurrence in the user timezone', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);
    expect(reminder).toMatchObject({
      text: 'Send the report',
      dueAt: MONDAY_9AM_IST,
      dueHasTime: true,
      recurrence: { days: [1], time: '09:00' },
      status: 'pending',
      createdByAi: true,
    });
    const [row] = await db.select().from(reminders);
    expect(row).toMatchObject({ recurrenceDays: [1], recurrenceTime: '09:00' });
  });

  it('is not due before its first occurrence, and nextDueAt points at it', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await createRecurring(ctx, u.cookie);
    const res = await due(ctx, u.cookie);
    expect(res.body.reminders).toEqual([]);
    expect(res.body.nextDueAt).toBe(MONDAY_9AM_IST);
  });
});

describe('alerts and acknowledgement of a repeating reminder', () => {
  it('alerts at the occurrence, and "Got it" moves it to the next one instead of finishing it', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);

    ctx.clock.at = new Date(MONDAY_9AM_IST);
    const dueNow = await due(ctx, u.cookie);
    expect(dueNow.body.reminders.map((r: { id: string }) => r.id)).toEqual([reminder.id]);

    const done = await ack(ctx, u.cookie, reminder.id);
    expect(done.status).toBe(200);
    expect(done.body.reminder).toMatchObject({
      status: 'pending', // it re-arms; it is never "finished"
      dueAt: NEXT_MONDAY_9AM_IST,
      acknowledgedAt: MONDAY_9AM_IST,
      recurrence: { days: [1], time: '09:00' },
    });

    const after = await due(ctx, u.cookie);
    expect(after.body.reminders).toEqual([]);
    expect(after.body.nextDueAt).toBe(NEXT_MONDAY_9AM_IST);
  });

  it('a double click or second tab cannot skip an occurrence', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);
    ctx.clock.at = new Date(MONDAY_9AM_IST);

    const results = await Promise.all([
      ack(ctx, u.cookie, reminder.id),
      ack(ctx, u.cookie, reminder.id),
      ack(ctx, u.cookie, reminder.id),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    const [row] = await db.select().from(reminders);
    // Advanced exactly once: next Monday, not two or three weeks ahead.
    expect(row?.dueAt?.toISOString()).toBe(NEXT_MONDAY_9AM_IST);
  });

  it('acknowledging before the occurrence is due changes nothing', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);
    const res = await ack(ctx, u.cookie, reminder.id);
    expect(res.status).toBe(200);
    expect(res.body.reminder.dueAt).toBe(MONDAY_9AM_IST);
    expect(res.body.reminder.status).toBe('pending');
  });

  it('after being away, the next occurrence is the first one after now (missed ones are not queued)', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);
    // Three weeks later, Wednesday 4 Nov 2026 12:00 IST: three Mondays were missed.
    ctx.clock.at = new Date('2026-11-04T06:30:00Z');
    expect((await due(ctx, u.cookie)).body.reminders).toHaveLength(1);
    const res = await ack(ctx, u.cookie, reminder.id);
    expect(res.body.reminder.dueAt).toBe('2026-11-09T03:30:00.000Z'); // Monday 9 Nov 09:00 IST
  });

  it('keeps working after a restart (a fresh app on the same database)', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);
    const restarted = ctx.build();
    ctx.clock.at = new Date(MONDAY_9AM_IST);
    const dueNow = await request(restarted).get('/api/reminders/due').set('Cookie', u.cookie);
    expect(dueNow.body.reminders).toHaveLength(1);
    const done = await request(restarted)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Cookie', u.cookie)
      .send({ acknowledged: true });
    expect(done.body.reminder.dueAt).toBe(NEXT_MONDAY_9AM_IST);
  });

  it('keeps 9:00 on the wall clock across the daylight-saving change (New York)', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: NEW_YORK });
    ctx.ai.respondWith(
      reply(
        weeklyMonday({
          due_local: '2026-03-02T09:00',
        }),
      ),
    );
    // Sunday 1 Mar 2026, 12:00 EST: the first occurrence is Monday 2 Mar 09:00 EST (14:00Z).
    ctx.clock.at = new Date('2026-03-01T17:00:00Z');
    const created = await request(ctx.app).post('/api/notes').set('Cookie', u.cookie).send(NOTE);
    expect(created.status).toBe(201);
    const [row] = await db.select().from(reminders);
    expect(row?.dueAt?.toISOString()).toBe('2026-03-02T14:00:00.000Z');

    // DST starts on Sunday 8 Mar: the next Monday 09:00 is EDT, one hour earlier in UTC.
    ctx.clock.at = new Date('2026-03-02T14:00:00Z');
    const done = await ack(ctx, u.cookie, row?.id ?? '');
    expect(done.body.reminder.dueAt).toBe('2026-03-09T13:00:00.000Z');
  });
});

describe('editing the schedule', () => {
  it('can change the days and the time, and marks the reminder as edited by the user', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);

    const res = await request(ctx.app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Cookie', u.cookie)
      .send({ recurrence: { days: [4, 2, 2] }, due: { date: '2026-10-13', time: '18:00' } });
    expect(res.status).toBe(200);
    expect(res.body.reminder.recurrence).toEqual({ days: [2, 4], time: '18:00' });
    // Tuesday 13 Oct 18:00 IST is ahead and on a schedule day: it is used as typed.
    expect(res.body.reminder.dueAt).toBe('2026-10-13T12:30:00.000Z');
    const [row] = await db.select().from(reminders);
    expect(row?.userModified).toBe(true);
  });

  it('moves a typed date that is not on the schedule to the next real occurrence', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);
    // 14 Oct is a Wednesday; the rule is Mondays.
    const res = await request(ctx.app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Cookie', u.cookie)
      .send({ due: { date: '2026-10-14', time: '07:30' } });
    expect(res.body.reminder.recurrence).toEqual({ days: [1], time: '07:30' });
    expect(res.body.reminder.dueAt).toBe('2026-10-12T02:00:00.000Z'); // Monday 07:30 IST
  });

  it('can make a one-off reminder repeat, and stop a repeating one', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    ctx.ai.respondWith(
      reply(
        item({
          kind: 'reminder',
          text: 'Call John',
          evidence: 'call john friday at 5pm',
          due_kind: 'datetime',
          due_expression: 'Friday at 5pm',
          due_local: '2026-10-09T17:00',
        }),
      ),
    );
    await request(ctx.app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'John', content: 'Call John Friday at 5pm' });
    const [row] = await db.select().from(reminders);
    const id = row?.id ?? '';
    expect(row?.recurrenceDays).toBeNull();

    const on = await request(ctx.app)
      .patch(`/api/reminders/${id}`)
      .set('Cookie', u.cookie)
      .send({ recurrence: { days: [5] } });
    expect(on.body.reminder.recurrence).toEqual({ days: [5], time: '17:00' });
    expect(on.body.reminder.dueAt).toBe('2026-10-09T11:30:00.000Z'); // unchanged: Friday 17:00 IST

    const off = await request(ctx.app)
      .patch(`/api/reminders/${id}`)
      .set('Cookie', u.cookie)
      .send({ recurrence: null });
    expect(off.body.reminder.recurrence).toBeNull();
    expect(off.body.reminder.dueAt).toBe('2026-10-09T11:30:00.000Z');
    const [after] = await db.select().from(reminders);
    expect(after).toMatchObject({ recurrenceDays: null, recurrenceTime: null });
  });

  it('refuses to make a reminder with no time repeat (a reminder needs a time)', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const [n] = await db
      .insert(notes)
      .values({ userId: u.user.id, title: 't', content: 'c', analysisStatus: 'ok' })
      .returning();
    const [r] = await db
      .insert(reminders)
      .values({ userId: u.user.id, sourceNoteId: n?.id ?? '', content: 'Stretch' })
      .returning();
    const res = await request(ctx.app)
      .patch(`/api/reminders/${r?.id}`)
      .set('Cookie', u.cookie)
      .send({ recurrence: { days: [1, 2, 3, 4, 5, 6, 7] } });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/date and time/i);
    const [row] = await db.select().from(reminders);
    expect(row?.recurrenceDays).toBeNull();
  });

  it.each([
    ['no days', { recurrence: { days: [] } }],
    ['day 0', { recurrence: { days: [0] } }],
    ['day 8', { recurrence: { days: [8] } }],
    ['a fractional day', { recurrence: { days: [1.5] } }],
    ['a string day', { recurrence: { days: ['1'] } }],
    ['more than seven days', { recurrence: { days: [1, 2, 3, 4, 5, 6, 7, 1] } }],
    ['a missing days list', { recurrence: {} }],
    ['an unknown recurrence key', { recurrence: { days: [1], every: 2 } }],
    ['a time inside recurrence', { recurrence: { days: [1], time: '09:00' } }],
  ])('rejects %s with 422 and changes nothing', async (_name, body) => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, u.cookie);
    const res = await request(ctx.app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Cookie', u.cookie)
      .send(body);
    expect(res.status).toBe(422);
    const [row] = await db.select().from(reminders);
    expect(row).toMatchObject({
      recurrenceDays: [1],
      recurrenceTime: '09:00',
      userModified: false,
    });
  });
});

describe('re-analysing the note', () => {
  it('does not move a live, unacknowledged occurrence', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { noteId, reminder } = await createRecurring(ctx, u.cookie);

    // Monday 09:00 arrives: the reminder is due and the user has not acknowledged it.
    ctx.clock.at = new Date('2026-10-12T04:00:00Z');
    expect((await due(ctx, u.cookie)).body.reminders).toHaveLength(1);

    // The user edits an unrelated part of the note; the model returns the same reminder.
    ctx.ai.respondWith(reply(weeklyMonday()));
    const edited = await request(ctx.app)
      .patch(`/api/notes/${noteId}`)
      .set('Cookie', u.cookie)
      .send({ content: `${NOTE.content}. Also buy stamps.` });
    expect(edited.status).toBe(200);

    const [row] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(row?.dueAt?.toISOString()).toBe(MONDAY_9AM_IST); // still the due occurrence
    expect((await due(ctx, u.cookie)).body.reminders).toHaveLength(1);
    expect(await db.select().from(reminders)).toHaveLength(1);
  });

  it('applies a changed schedule from the note', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { noteId } = await createRecurring(ctx, u.cookie);

    ctx.ai.respondWith(
      reply(
        weeklyMonday({
          evidence: 'send the report every tuesday at 9am',
          due_expression: 'every Tuesday at 9am',
          due_local: '2026-10-13T09:00',
          recurrence_weekdays: [2],
          recurrence_expression: 'every Tuesday',
        }),
      ),
    );
    await request(ctx.app)
      .patch(`/api/notes/${noteId}`)
      .set('Cookie', u.cookie)
      .send({ content: 'Remind me to send the report every Tuesday at 9am' });

    const [row] = await db.select().from(reminders);
    expect(row).toMatchObject({ recurrenceDays: [2], recurrenceTime: '09:00' });
    expect(row?.dueAt?.toISOString()).toBe('2026-10-13T03:30:00.000Z');
    expect(await db.select().from(reminders)).toHaveLength(1); // updated in place, no duplicate
  });

  it('a deleted repeating reminder is not brought back by re-analysis', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const { noteId, reminder } = await createRecurring(ctx, u.cookie);
    const del = await request(ctx.app)
      .delete(`/api/reminders/${reminder.id}`)
      .set('Cookie', u.cookie);
    expect(del.status).toBe(204);

    ctx.ai.respondWith(reply(weeklyMonday()));
    await request(ctx.app)
      .patch(`/api/notes/${noteId}`)
      .set('Cookie', u.cookie)
      .send({ content: `${NOTE.content}!` });
    expect(await db.select().from(reminders)).toHaveLength(0);
  });
});

describe('ownership', () => {
  it("another user cannot see, edit or acknowledge someone's repeating reminder", async () => {
    const ctx = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com', timezone: KOLKATA });
    const b = await createUserWithSession(db, { email: 'b@example.com', timezone: KOLKATA });
    const { reminder } = await createRecurring(ctx, a.cookie);
    ctx.clock.at = new Date(MONDAY_9AM_IST);

    expect((await due(ctx, b.cookie)).body.reminders).toEqual([]);
    const list = await request(ctx.app).get('/api/reminders').set('Cookie', b.cookie);
    expect(list.body.reminders).toEqual([]);
    for (const body of [
      { acknowledged: true },
      { recurrence: null },
      { recurrence: { days: [2] } },
    ]) {
      const res = await request(ctx.app)
        .patch(`/api/reminders/${reminder.id}`)
        .set('Cookie', b.cookie)
        .send(body);
      expect(res.status).toBe(404);
    }
    const [row] = await db.select().from(reminders);
    expect(row).toMatchObject({ recurrenceDays: [1], status: 'pending', userModified: false });
    expect(row?.dueAt?.toISOString()).toBe(MONDAY_9AM_IST);
  });
});

describe('database constraints', () => {
  async function seedReminder() {
    const u = await createUserWithSession(db);
    const [n] = await db
      .insert(notes)
      .values({ userId: u.user.id, title: 't', content: 'c', analysisStatus: 'ok' })
      .returning();
    return { userId: u.user.id, noteId: n?.id ?? '' };
  }

  it.each([
    ['an empty day list', "'{}'::smallint[]", 'null'],
    ['day 0', "'{0}'::smallint[]", 'null'],
    ['day 8', "'{8}'::smallint[]", 'null'],
    ['a time without days', 'null', "'09:00'"],
    ['a malformed time', "'{1}'::smallint[]", "'9:00'"],
    ['hour 24', "'{1}'::smallint[]", "'24:00'"],
  ])('refuses %s', async (_name, days, time) => {
    const { userId, noteId } = await seedReminder();
    await expect(
      db.execute(
        sql.raw(
          `insert into reminders (user_id, source_note_id, content, recurrence_days, recurrence_time) ` +
            `values ('${userId}', '${noteId}', 'x', ${days}, ${time})`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('accepts a valid schedule', async () => {
    const { userId, noteId } = await seedReminder();
    await db.execute(
      sql.raw(
        `insert into reminders (user_id, source_note_id, content, recurrence_days, recurrence_time) ` +
          `values ('${userId}', '${noteId}', 'x', '{1,3,5}', '09:30')`,
      ),
    );
    expect(await db.select().from(reminders)).toHaveLength(1);
  });
});
