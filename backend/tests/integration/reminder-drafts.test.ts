import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { aiDismissed, notes, reminderDrafts, reminders } from '../../src/db/schema.js';
import { FakeAI, item, reply } from '../helpers/fakeAi.js';
import {
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

const NOTE = { title: 'Invoice', content: 'Remind John to send the invoice on Friday at 5pm' };

// A reminder with a stated day but no time of day.
const dateOnly = (over: Record<string, unknown> = {}) =>
  item({
    kind: 'reminder',
    text: 'Send the invoice',
    person: 'John',
    evidence: 'remind john to send the invoice on friday',
    due_kind: 'date',
    due_expression: 'Friday',
    due_local: '2026-10-09',
    ...over,
  });

// A reminder with neither date nor time.
const undated = () =>
  item({
    kind: 'reminder',
    text: 'Call the bank',
    evidence: 'call the bank',
    due_kind: 'none',
  });

const complete = () =>
  item({
    kind: 'reminder',
    text: 'Send the invoice',
    person: 'John',
    evidence: 'remind john to send the invoice on friday at 5pm',
    due_kind: 'datetime',
    due_expression: 'Friday at 5pm',
    due_local: '2026-10-09T17:00',
  });

function setup() {
  const ai = new FakeAI();
  const app = buildApp(db, testEnv(), undefined, { ai });
  return { ai, app };
}

async function saveNote(
  ctx: ReturnType<typeof setup>,
  cookie: string,
  body: { title: string; content: string },
  ...items: ReturnType<typeof item>[]
) {
  ctx.ai.respondWith(reply(...items));
  const res = await request(ctx.app).post('/api/notes').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.note as { id: string; analysis: Record<string, unknown> };
}

const drafts = (ctx: ReturnType<typeof setup>, cookie: string) =>
  request(ctx.app).get('/api/reminder-drafts').set('Cookie', cookie);
const reminderList = (ctx: ReturnType<typeof setup>, cookie: string) =>
  request(ctx.app).get('/api/reminders').set('Cookie', cookie);
const completeDraft = (
  ctx: ReturnType<typeof setup>,
  cookie: string,
  id: string,
  body: Record<string, unknown>,
) => request(ctx.app).post(`/api/reminder-drafts/${id}/complete`).set('Cookie', cookie).send(body);

describe('a reminder without a valid date and time', () => {
  it('keeps the note, creates no reminder, and offers a pending reminder instead', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(
      ctx,
      u.cookie,
      { title: 'Bank', content: 'Call the bank' },
      undated(),
    );

    expect(note.analysis).toMatchObject({ status: 'ok', reminders: 0, pendingReminders: 1 });
    expect((await reminderList(ctx, u.cookie)).body.reminders).toEqual([]);
    expect(await db.select().from(reminders)).toHaveLength(0);
    expect(await db.select().from(notes)).toHaveLength(1); // the note is preserved

    const list = (await drafts(ctx, u.cookie)).body.drafts;
    expect(list).toEqual([
      expect.objectContaining({
        text: 'Call the bank',
        suggestedDate: null,
        recurrence: null,
        sourceNote: expect.objectContaining({ id: note.id }),
      }),
    ]);
  });

  it('a date without a time is pending too: the date is offered, no time is invented', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await saveNote(ctx, u.cookie, NOTE, dateOnly());

    expect(await db.select().from(reminders)).toHaveLength(0);
    const [draft] = (await drafts(ctx, u.cookie)).body.drafts;
    expect(draft).toMatchObject({ text: 'Send the invoice', person: 'John' });
    expect(draft.suggestedDate).toBe('2026-10-09');
    // The API never offers a time (or any due instant) for a pending reminder.
    expect(Object.keys(draft).sort()).toEqual(
      ['createdAt', 'id', 'person', 'recurrence', 'sourceNote', 'suggestedDate', 'text'].sort(),
    );
  });

  it('an ambiguous date the note does not support is not turned into one', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    // "sometime" is not a date: the model claims 2026-10-09 but its quoted words are not in the note.
    await saveNote(
      ctx,
      u.cookie,
      { title: 'Vague', content: 'Remind John to send the invoice sometime' },
      dateOnly({
        evidence: 'remind john to send the invoice sometime',
        due_expression: 'next Friday',
        due_local: '2026-10-16',
      }),
    );
    expect(await db.select().from(reminders)).toHaveLength(0);
    const [draft] = (await drafts(ctx, u.cookie)).body.drafts;
    expect(draft.suggestedDate).toBeNull();
  });

  it('a complete reminder is still saved straight away', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(ctx, u.cookie, NOTE, complete());
    expect(note.analysis).toMatchObject({ reminders: 1, pendingReminders: 0 });
    const [r] = (await reminderList(ctx, u.cookie)).body.reminders;
    expect(r.dueAt).toBe('2026-10-09T11:30:00.000Z'); // 17:00 in Kolkata
    expect(r.dueHasTime).toBe(true);
    expect((await drafts(ctx, u.cookie)).body.drafts).toEqual([]);
  });

  it('a repeating reminder with no time of day is pending until a time is given', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await saveNote(
      ctx,
      u.cookie,
      { title: 'Weekly', content: 'Remind me to send the report every Monday' },
      item({
        kind: 'reminder',
        text: 'Send the report',
        evidence: 'send the report every monday',
        due_kind: 'none',
        recurrence_kind: 'weekly',
        recurrence_weekdays: [1],
        recurrence_expression: 'every Monday',
      }),
    );
    expect(await db.select().from(reminders)).toHaveLength(0);
    const [draft] = (await drafts(ctx, u.cookie)).body.drafts;
    expect(draft.recurrence).toEqual({ days: [1] });

    const done = await completeDraft(ctx, u.cookie, draft.id, { time: '09:00' });
    expect(done.status).toBe(201);
    expect(done.body.reminder).toMatchObject({
      recurrence: { days: [1], time: '09:00' },
      dueHasTime: true,
      dueAt: '2026-10-12T03:30:00.000Z', // next Monday 09:00 IST
    });
  });
});

describe('supplying the missing date and time', () => {
  async function pending() {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await saveNote(ctx, u.cookie, NOTE, dateOnly());
    const [draft] = (await drafts(ctx, u.cookie)).body.drafts;
    return { ctx, u, draft };
  }

  it('creates the reminder at the typed local date and time, and removes the pending item', async () => {
    const { ctx, u, draft } = await pending();
    const res = await completeDraft(ctx, u.cookie, draft.id, { date: '2026-10-09', time: '17:00' });
    expect(res.status).toBe(201);
    expect(res.body.reminder).toMatchObject({
      text: 'Send the invoice',
      person: 'John',
      dueAt: '2026-10-09T11:30:00.000Z',
      dueHasTime: true,
      status: 'pending',
    });
    expect((await drafts(ctx, u.cookie)).body.drafts).toEqual([]);
    const [row] = await db.select().from(reminders);
    expect(row).toMatchObject({ userModified: true, createdByAi: true });
  });

  it('refuses a missing time, a missing date, a bad time and impossible dates', async () => {
    const { ctx, u, draft } = await pending();
    const cases: [Record<string, unknown>, number][] = [
      [{ date: '2026-10-09' }, 422], // no time
      [{ time: '17:00' }, 422], // no date for a one-off
      [{ date: '2026-10-09', time: '25:99' }, 422],
      [{ date: '2026-10-09', time: '' }, 422],
      [{ date: '2026-02-30', time: '10:00' }, 422], // impossible calendar date
      [{ date: '09/10/2026', time: '10:00' }, 422],
      [{ date: '2026-10-09', time: '10:00', status: 'done' }, 422], // unknown field
      [{ date: '2026-10-09', time: '10:00', userId: 'x' }, 422],
    ];
    for (const [body, status] of cases) {
      const res = await completeDraft(ctx, u.cookie, draft.id, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
    }
    // Nothing was created by any of the refused attempts.
    expect(await db.select().from(reminders)).toHaveLength(0);
    expect((await drafts(ctx, u.cookie)).body.drafts).toHaveLength(1);
  });

  it('refuses a time that has already passed', async () => {
    const { ctx, u, draft } = await pending();
    const res = await completeDraft(ctx, u.cookie, draft.id, { date: '2026-10-08', time: '09:00' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/already passed/i);
    expect(await db.select().from(reminders)).toHaveLength(0);
  });

  it('a double submit creates exactly one reminder', async () => {
    const { ctx, u, draft } = await pending();
    const body = { date: '2026-10-09', time: '17:00' };
    const [a, b] = await Promise.all([
      completeDraft(ctx, u.cookie, draft.id, body),
      completeDraft(ctx, u.cookie, draft.id, body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 404]);
    expect(await db.select().from(reminders)).toHaveLength(1);
  });

  it("another user cannot see or complete someone else's pending reminder", async () => {
    const { ctx, draft } = await pending();
    const other = await createUserWithSession(db, { email: 'other@example.com' });
    expect((await drafts(ctx, other.cookie)).body.drafts).toEqual([]);
    const res = await completeDraft(ctx, other.cookie, draft.id, {
      date: '2026-10-09',
      time: '17:00',
    });
    expect(res.status).toBe(404);
    const del = await request(ctx.app)
      .delete(`/api/reminder-drafts/${draft.id}`)
      .set('Cookie', other.cookie);
    expect(del.status).toBe(404);
    expect(await db.select().from(reminderDrafts)).toHaveLength(1);
  });

  it('requires a signed-in user on every route', async () => {
    const { ctx } = await pending();
    const id = '00000000-0000-4000-8000-000000000000';
    const results = await Promise.all([
      request(ctx.app).get('/api/reminder-drafts'),
      request(ctx.app).post(`/api/reminder-drafts/${id}/complete`).send({ time: '10:00' }),
      request(ctx.app).delete(`/api/reminder-drafts/${id}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401]);
  });
});

describe('re-analysis and dismissal', () => {
  it('dismissing a pending reminder keeps it from coming back on re-analysis', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(ctx, u.cookie, NOTE, dateOnly());
    const [draft] = (await drafts(ctx, u.cookie)).body.drafts;

    const del = await request(ctx.app)
      .delete(`/api/reminder-drafts/${draft.id}`)
      .set('Cookie', u.cookie);
    expect(del.status).toBe(204);
    expect(await db.select().from(aiDismissed)).toHaveLength(1);

    ctx.ai.respondWith(reply(dateOnly()));
    const edit = await request(ctx.app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: `${NOTE.content} please` });
    expect(edit.status).toBe(200);
    expect((await drafts(ctx, u.cookie)).body.drafts).toEqual([]);
  });

  it('adding a time to the note turns the pending reminder into a real one, once', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(ctx, u.cookie, NOTE, dateOnly());
    expect((await drafts(ctx, u.cookie)).body.drafts).toHaveLength(1);

    ctx.ai.respondWith(reply(complete()));
    await request(ctx.app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: 'Remind John to send the invoice on Friday at 5pm sharp.' });
    expect((await drafts(ctx, u.cookie)).body.drafts).toEqual([]);
    expect(await db.select().from(reminders)).toHaveLength(1);
  });

  it('a pending reminder is not duplicated by re-saving the note', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(ctx, u.cookie, NOTE, dateOnly());
    for (let i = 0; i < 2; i++) {
      ctx.ai.respondWith(reply(dateOnly()));
      await request(ctx.app)
        .patch(`/api/notes/${note.id}`)
        .set('Cookie', u.cookie)
        .send({ content: `${NOTE.content}${' '.repeat(i + 1)}.` });
    }
    expect((await drafts(ctx, u.cookie)).body.drafts).toHaveLength(1);
  });

  it('a completed reminder is not recreated as a pending one by re-analysis', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(ctx, u.cookie, NOTE, dateOnly());
    const [draft] = (await drafts(ctx, u.cookie)).body.drafts;
    await completeDraft(ctx, u.cookie, draft.id, { date: '2026-10-09', time: '17:00' });

    ctx.ai.respondWith(reply(dateOnly()));
    await request(ctx.app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: `${NOTE.content} thanks` });
    expect((await drafts(ctx, u.cookie)).body.drafts).toEqual([]);
    const all = await db.select().from(reminders);
    expect(all).toHaveLength(1);
    expect(all[0]?.dueAt?.toISOString()).toBe('2026-10-09T11:30:00.000Z'); // untouched
  });

  it('deleting the note removes its pending reminders', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(ctx, u.cookie, NOTE, dateOnly());
    await request(ctx.app).delete(`/api/notes/${note.id}`).set('Cookie', u.cookie);
    expect(await db.select().from(reminderDrafts)).toHaveLength(0);
  });
});

describe('a reminder cannot lose its date or time through the other routes', () => {
  async function saved() {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    await saveNote(ctx, u.cookie, NOTE, complete());
    const [r] = (await reminderList(ctx, u.cookie)).body.reminders;
    return { ctx, u, id: r.id as string };
  }
  const patch = (c: Awaited<ReturnType<typeof saved>>, body: Record<string, unknown>) =>
    request(c.ctx.app).patch(`/api/reminders/${c.id}`).set('Cookie', c.u.cookie).send(body);

  it('refuses clearing the due date', async () => {
    const c = await saved();
    const res = await patch(c, { due: null });
    expect(res.status).toBe(422);
    const [row] = await db.select().from(reminders).where(eq(reminders.id, c.id));
    expect(row?.dueAt?.toISOString()).toBe('2026-10-09T11:30:00.000Z');
  });

  it('refuses a date without a time', async () => {
    const c = await saved();
    expect((await patch(c, { due: { date: '2026-10-10' } })).status).toBe(422);
    expect((await patch(c, { due: { date: '2026-10-10', time: null } })).status).toBe(422);
    expect((await patch(c, { due: { date: '2026-10-10', time: '' } })).status).toBe(422);
  });

  it('still lets a complete date and time be changed, and text be edited', async () => {
    const c = await saved();
    const res = await patch(c, { due: { date: '2026-10-10', time: '09:15' }, text: 'Send it' });
    expect(res.status).toBe(200);
    expect(res.body.reminder).toMatchObject({
      text: 'Send it',
      dueAt: '2026-10-10T03:45:00.000Z',
      dueHasTime: true,
    });
  });

  it('refuses making a legacy reminder without a time repeat', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db, { timezone: KOLKATA });
    const note = await saveNote(ctx, u.cookie, NOTE);
    // A row from before this rule: a reminder with no time at all.
    const [legacy] = await db
      .insert(reminders)
      .values({ userId: u.user.id, sourceNoteId: note.id, content: 'Old one', dueAt: null })
      .returning();
    const res = await request(ctx.app)
      .patch(`/api/reminders/${legacy?.id}`)
      .set('Cookie', u.cookie)
      .send({ recurrence: { days: [1] } });
    expect(res.status).toBe(422);
    // Text-only edits of such a legacy reminder keep working.
    const ok = await request(ctx.app)
      .patch(`/api/reminders/${legacy?.id}`)
      .set('Cookie', u.cookie)
      .send({ text: 'Old one, renamed' });
    expect(ok.status).toBe(200);
  });
});
