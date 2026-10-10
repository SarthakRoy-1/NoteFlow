import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { aiDismissed, notes, reminders } from '../../src/db/schema.js';
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

const NIL_UUID = '00000000-0000-4000-8000-000000000000';
// FIXED_NOW = Thu 2026-10-08T10:00:00Z
const PAST = new Date('2026-10-08T08:00:00Z');
const FUTURE = new Date('2026-10-09T08:00:00Z');
const LATER = new Date('2026-10-20T08:00:00Z');

function setup(now: Date = FIXED_NOW) {
  const ai = new FakeAI();
  const app = buildApp(db, testEnv(), undefined, { ai, now: () => now });
  return { ai, app };
}

async function seedNote(userId: string, title = 'Source note') {
  const [n] = await db
    .insert(notes)
    .values({ userId, title, content: 'content', analysisStatus: 'ok' })
    .returning();
  if (!n) throw new Error('seed failed');
  return n;
}

async function seedReminder(
  userId: string,
  noteId: string,
  partial: Partial<typeof reminders.$inferInsert> = {},
) {
  const [r] = await db
    .insert(reminders)
    .values({ userId, sourceNoteId: noteId, content: 'Send the invoice', ...partial })
    .returning();
  if (!r) throw new Error('seed failed');
  return r;
}

const row = async (id: string) =>
  (await db.select().from(reminders).where(eq(reminders.id, id)))[0];

describe('authentication required', () => {
  it('rejects list, due, get, patch and delete without a session and changes nothing', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const r = await seedReminder(u.user.id, (await seedNote(u.user.id)).id, { dueAt: PAST });
    const url = `/api/reminders/${r.id}`;
    const results = await Promise.all([
      request(app).get('/api/reminders'),
      request(app).get('/api/reminders/due'),
      request(app).get(url),
      request(app).patch(url).send({ acknowledged: true }),
      request(app).delete(url),
    ]);
    for (const res of results) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(await row(r.id)).toMatchObject({ status: 'pending', content: 'Send the invoice' });
  });

  it('rejects an expired session', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db, { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).get('/api/reminders').set('Cookie', u.cookie)).status).toBe(401);
    expect((await request(app).get('/api/reminders/due').set('Cookie', u.cookie)).status).toBe(401);
  });
});

describe('GET /api/reminders', () => {
  it('returns an empty list for a new user', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const res = await request(app).get('/api/reminders').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminders: [] });
  });

  it("returns only the caller's reminders", async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedReminder(a.user.id, (await seedNote(a.user.id)).id, { content: 'A reminder' });
    await seedReminder(b.user.id, (await seedNote(b.user.id, 'B note')).id, {
      content: 'B secret',
      person: 'Bob',
    });
    const res = await request(app).get('/api/reminders').set('Cookie', a.cookie);
    expect(res.body.reminders.map((r: { text: string }) => r.text)).toEqual(['A reminder']);
    expect(JSON.stringify(res.body)).not.toMatch(/B secret|B note|Bob/);
  });

  it('ignores a user_id query parameter', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedReminder(b.user.id, (await seedNote(b.user.id)).id);
    const res = await request(app)
      .get(`/api/reminders?user_id=${b.user.id}`)
      .set('Cookie', a.cookie);
    expect(res.body.reminders).toEqual([]);
  });

  it('includes person, source note and only safe fields', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id, 'Invoice note');
    await seedReminder(u.user.id, note.id, {
      person: 'John',
      dueAt: FUTURE,
      createdByAi: true,
      aiFingerprint: 'secret-fp',
    });
    const res = await request(app).get('/api/reminders').set('Cookie', u.cookie);
    const [r] = res.body.reminders;
    expect(r).toMatchObject({
      text: 'Send the invoice',
      person: 'John',
      dueAt: FUTURE.toISOString(),
      dueHasTime: true,
      status: 'pending',
      acknowledgedAt: null,
      createdByAi: true,
      sourceNote: { id: note.id, title: 'Invoice note' },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('secret-fp');
    expect(text).not.toContain(u.user.id);
    expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['userId', 'aiFingerprint']));
  });

  it('orders pending first, soonest due first, undated after dated, handled ones last', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const n = (await seedNote(u.user.id)).id;
    await seedReminder(u.user.id, n, { content: 'undated' });
    await seedReminder(u.user.id, n, { content: 'later', dueAt: LATER });
    await seedReminder(u.user.id, n, { content: 'soon', dueAt: FUTURE });
    await seedReminder(u.user.id, n, { content: 'overdue', dueAt: PAST });
    await seedReminder(u.user.id, n, {
      content: 'handled-early',
      dueAt: new Date('2026-01-01T00:00:00Z'),
      status: 'acknowledged',
    });
    const res = await request(app).get('/api/reminders').set('Cookie', u.cookie);
    expect(res.body.reminders.map((r: { text: string }) => r.text)).toEqual([
      'overdue',
      'soon',
      'later',
      'undated',
      'handled-early',
    ]);
  });

  it('shows reminders the AI created when a note was saved (person + exact time, user timezone)', async () => {
    const { app, ai } = setup();
    ai.respondWith(
      reply(
        item({
          kind: 'reminder',
          text: 'Send the invoice',
          person: 'John',
          evidence: 'remind John to send the invoice by Friday 5pm',
          due_kind: 'datetime',
          due_expression: 'Friday 5pm',
          due_local: '2026-10-09T17:00',
        }),
      ),
    );
    const u = await createUserWithSession(db, { timezone: 'America/New_York' });
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Invoice', content: 'remind John to send the invoice by Friday 5pm' });
    const res = await request(app).get('/api/reminders').set('Cookie', u.cookie);
    expect(res.body.reminders).toHaveLength(1);
    expect(res.body.reminders[0]).toMatchObject({
      text: 'Send the invoice',
      person: 'John',
      dueHasTime: true,
      dueAt: '2026-10-09T21:00:00.000Z', // 17:00 EDT
      createdByAi: true,
      status: 'pending',
      sourceNote: { id: created.body.note.id, title: 'Invoice' },
    });
  });

  it('does not turn a date-only AI reminder into a reminder (no time is invented)', async () => {
    const { app, ai } = setup();
    ai.respondWith(
      reply(
        item({
          kind: 'reminder',
          text: 'Renew the visa',
          evidence: 'remind me to renew the visa tomorrow',
          due_kind: 'date',
          due_expression: 'tomorrow',
          due_local: '2026-10-09',
        }),
      ),
    );
    const u = await createUserWithSession(db, { timezone: 'Asia/Tokyo' });
    await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Visa', content: 'remind me to renew the visa tomorrow' });
    expect(
      (await request(app).get('/api/reminders').set('Cookie', u.cookie)).body.reminders,
    ).toEqual([]);
    const drafts = (await request(app).get('/api/reminder-drafts').set('Cookie', u.cookie)).body
      .drafts;
    expect(drafts).toEqual([
      expect.objectContaining({ text: 'Renew the visa', suggestedDate: '2026-10-09' }),
    ]);
  });

  it('a reminder with no date or time is a pending reminder, not a listed reminder', async () => {
    const { app, ai } = setup();
    ai.respondWith(
      reply(item({ kind: 'reminder', text: 'Call mum', evidence: 'remind me to call mum' })),
    );
    const u = await createUserWithSession(db);
    await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Mum', content: 'remind me to call mum' });
    expect(
      (await request(app).get('/api/reminders').set('Cookie', u.cookie)).body.reminders,
    ).toEqual([]);
    const drafts = (await request(app).get('/api/reminder-drafts').set('Cookie', u.cookie)).body
      .drafts;
    expect(drafts).toEqual([expect.objectContaining({ text: 'Call mum', person: null })]);
  });

  it('disappears from the list when its source note is deleted', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    await seedReminder(u.user.id, note.id);
    await request(app).delete(`/api/notes/${note.id}`).set('Cookie', u.cookie);
    expect(
      (await request(app).get('/api/reminders').set('Cookie', u.cookie)).body.reminders,
    ).toEqual([]);
  });
});

describe('GET /api/reminders/due (in-app alerts)', () => {
  const dueTexts = async (app: ReturnType<typeof buildApp>, cookie: string) =>
    (await request(app).get('/api/reminders/due').set('Cookie', cookie)).body.reminders.map(
      (r: { text: string }) => r.text,
    );

  it('returns only pending reminders whose time has arrived, soonest first', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const n = (await seedNote(u.user.id)).id;
    await seedReminder(u.user.id, n, { content: 'recent', dueAt: PAST });
    await seedReminder(u.user.id, n, {
      content: 'long ago',
      dueAt: new Date('2026-09-01T00:00:00Z'),
    });
    await seedReminder(u.user.id, n, { content: 'exactly now', dueAt: FIXED_NOW });
    await seedReminder(u.user.id, n, { content: 'future', dueAt: FUTURE });
    await seedReminder(u.user.id, n, { content: 'no time at all' });
    await seedReminder(u.user.id, n, { content: 'handled', dueAt: PAST, status: 'acknowledged' });
    expect(await dueTexts(app, u.cookie)).toEqual(['long ago', 'recent', 'exactly now']);
  });

  it('never alerts for a reminder without a due time', async () => {
    const { app } = setup(new Date('2100-01-01T00:00:00Z'));
    const u = await createUserWithSession(db);
    await seedReminder(u.user.id, (await seedNote(u.user.id)).id, { content: 'no time' });
    expect(await dueTexts(app, u.cookie)).toEqual([]);
  });

  it('is decided by the server clock: the same reminder becomes due as time passes', async () => {
    const u = await createUserWithSession(db);
    await seedReminder(u.user.id, (await seedNote(u.user.id)).id, {
      content: 'soon',
      dueAt: FUTURE,
    });
    expect(await dueTexts(setup(FIXED_NOW).app, u.cookie)).toEqual([]);
    expect(await dueTexts(setup(new Date(FUTURE.getTime() - 1)).app, u.cookie)).toEqual([]);
    expect(await dueTexts(setup(FUTURE).app, u.cookie)).toEqual(['soon']);
    expect(await dueTexts(setup(new Date(FUTURE.getTime() + 60_000)).app, u.cookie)).toEqual([
      'soon',
    ]);
  });

  it('a date-only reminder alerts from the start of its local day, with no invented time', async () => {
    const u = await createUserWithSession(db, { timezone: 'Asia/Kolkata' });
    // Fri 9 Oct, date only, in Kolkata: starts at 8 Oct 18:30Z
    await seedReminder(u.user.id, (await seedNote(u.user.id)).id, {
      content: 'visa',
      dueAt: new Date('2026-10-08T18:30:00Z'),
      dueHasTime: false,
    });
    expect(await dueTexts(setup(new Date('2026-10-08T18:29:00Z')).app, u.cookie)).toEqual([]);
    const res = await request(setup(new Date('2026-10-08T18:31:00Z')).app)
      .get('/api/reminders/due')
      .set('Cookie', u.cookie);
    expect(res.body.reminders).toHaveLength(1);
    expect(res.body.reminders[0]).toMatchObject({ text: 'visa', dueHasTime: false });
  });

  it('reports the next upcoming alert time (null when there is none)', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const n = (await seedNote(u.user.id)).id;
    expect((await request(app).get('/api/reminders/due').set('Cookie', u.cookie)).body).toEqual({
      reminders: [],
      nextDueAt: null,
    });
    await seedReminder(u.user.id, n, { content: 'later', dueAt: LATER });
    await seedReminder(u.user.id, n, { content: 'soon', dueAt: FUTURE });
    await seedReminder(u.user.id, n, {
      content: 'handled future',
      dueAt: new Date('2026-10-08T11:00:00Z'),
      status: 'acknowledged',
    });
    const res = await request(app).get('/api/reminders/due').set('Cookie', u.cookie);
    expect(res.body.nextDueAt).toBe(FUTURE.toISOString());
  });

  it("does not include another user's reminders (or reveal their next alert)", async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedReminder(b.user.id, (await seedNote(b.user.id)).id, {
      content: 'B due',
      dueAt: PAST,
    });
    await seedReminder(b.user.id, (await seedNote(b.user.id)).id, {
      content: 'B later',
      dueAt: FUTURE,
    });
    const res = await request(app).get('/api/reminders/due').set('Cookie', a.cookie);
    expect(res.body).toEqual({ reminders: [], nextDueAt: null });
    expect(await dueTexts(app, b.cookie)).toEqual(['B due']);
  });

  it('acknowledging removes the alert and it does not come back', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const r = await seedReminder(u.user.id, (await seedNote(u.user.id)).id, { dueAt: PAST });
    expect(await dueTexts(app, u.cookie)).toHaveLength(1);
    await request(app)
      .patch(`/api/reminders/${r.id}`)
      .set('Cookie', u.cookie)
      .send({ acknowledged: true });
    expect(await dueTexts(app, u.cookie)).toEqual([]);
    expect(await dueTexts(setup().app, u.cookie)).toEqual([]);
  });

  it('is not shadowed by the :id route', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const res = await request(app).get('/api/reminders/due').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reminders');
  });
});

describe('GET /api/reminders/:id', () => {
  it("returns the caller's reminder", async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const r = await seedReminder(u.user.id, (await seedNote(u.user.id)).id, { person: 'John' });
    const res = await request(app).get(`/api/reminders/${r.id}`).set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.reminder).toMatchObject({ id: r.id, person: 'John' });
  });

  it("returns 404 for another user's reminder without revealing anything", async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const r = await seedReminder(a.user.id, (await seedNote(a.user.id, 'private note')).id, {
      content: 'private reminder',
      person: 'Secret Person',
    });
    const res = await request(app).get(`/api/reminders/${r.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/private|Secret/);
  });

  it.each([NIL_UUID, 'not-a-uuid', '1', "' or 1=1 --"])('returns 404 for id %j', async (id) => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const res = await request(app)
      .get(`/api/reminders/${encodeURIComponent(id)}`)
      .set('Cookie', u.cookie);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/reminders/:id', () => {
  async function one(partial: Partial<typeof reminders.$inferInsert> = {}, tz = 'Asia/Kolkata') {
    const { app, ai } = setup();
    const u = await createUserWithSession(db, { timezone: tz });
    const note = await seedNote(u.user.id);
    const r = await seedReminder(u.user.id, note.id, partial);
    const patch = (body: object) =>
      request(app).patch(`/api/reminders/${r.id}`).set('Cookie', u.cookie).send(body);
    return { app, ai, u, note, r, patch };
  }

  it('edits the text (trimmed) and marks the reminder user-modified', async () => {
    const { r, patch } = await one();
    const res = await patch({ text: '  Send the final invoice  ' });
    expect(res.status).toBe(200);
    expect(res.body.reminder.text).toBe('Send the final invoice');
    expect(await row(r.id)).toMatchObject({
      content: 'Send the final invoice',
      userModified: true,
    });
  });

  it('sets, changes and clears the person (blank clears it)', async () => {
    const { r, patch } = await one();
    expect((await patch({ person: ' John ' })).body.reminder.person).toBe('John');
    expect((await row(r.id))?.userModified).toBe(true);
    expect((await patch({ person: 'Anita' })).body.reminder.person).toBe('Anita');
    expect((await patch({ person: '   ' })).body.reminder.person).toBeNull();
    expect((await patch({ person: 'Sam' })).body.reminder.person).toBe('Sam');
    expect((await patch({ person: null })).body.reminder.person).toBeNull();
    expect((await row(r.id))?.person).toBeNull();
  });

  it('refuses a date-only due date: a reminder needs a time too', async () => {
    const { patch, r } = await one();
    const res = await patch({ due: { date: '2026-10-09' } });
    expect(res.status).toBe(422);
    expect(await row(r.id)).toMatchObject({ dueAt: r.dueAt });
  });

  it('sets a due date and time in the user timezone', async () => {
    const { patch } = await one({}, 'America/New_York');
    const res = await patch({ due: { date: '2026-10-09', time: '17:00' } });
    expect(res.body.reminder).toMatchObject({
      dueHasTime: true,
      dueAt: '2026-10-09T21:00:00.000Z',
    });
  });

  it('respects daylight saving when converting the due time', async () => {
    const { patch } = await one({}, 'America/New_York');
    expect((await patch({ due: { date: '2026-10-30', time: '09:00' } })).body.reminder.dueAt).toBe(
      '2026-10-30T13:00:00.000Z',
    );
    expect((await patch({ due: { date: '2026-11-02', time: '09:00' } })).body.reminder.dueAt).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  it('refuses to clear the due date: a reminder always keeps a date and time', async () => {
    const { patch, r } = await one({ dueAt: PAST });
    const res = await patch({ due: null });
    expect(res.status).toBe(422);
    expect((await row(r.id))?.dueAt?.toISOString()).toBe(PAST.toISOString());
  });

  it('acknowledging and re-opening persists status and timestamp', async () => {
    const { patch, r } = await one({ dueAt: PAST });
    const ack = await patch({ acknowledged: true });
    expect(ack.body.reminder).toMatchObject({
      status: 'acknowledged',
      acknowledgedAt: FIXED_NOW.toISOString(),
    });
    expect(await row(r.id)).toMatchObject({ status: 'acknowledged', userModified: false });
    const reopen = await patch({ acknowledged: false });
    expect(reopen.body.reminder).toMatchObject({ status: 'pending', acknowledgedAt: null });
    expect((await row(r.id))?.alertedAt).toBeNull();
  });

  it('changing the due date of an acknowledged reminder re-arms its alert', async () => {
    const { patch } = await one({ dueAt: PAST, status: 'acknowledged', alertedAt: PAST });
    const res = await patch({ due: { date: '2026-12-01', time: '09:00' } });
    expect(res.body.reminder).toMatchObject({ status: 'pending', acknowledgedAt: null });
  });

  it('keeps the persisted state across a fresh app instance (PostgreSQL, not memory)', async () => {
    const { patch, r, u } = await one({ dueAt: PAST });
    await patch({ acknowledged: true });
    const fresh = buildApp(db, testEnv(), undefined, { now: () => FIXED_NOW });
    const res = await request(fresh).get(`/api/reminders/${r.id}`).set('Cookie', u.cookie);
    expect(res.body.reminder.status).toBe('acknowledged');
  });

  it('applies several fields at once and stamps updated_at from the server clock', async () => {
    const { patch, r } = await one();
    const res = await patch({
      text: 'New text',
      person: 'John',
      due: { date: '2026-10-12', time: '09:30' },
    });
    expect(res.body.reminder).toMatchObject({ text: 'New text', person: 'John', dueHasTime: true });
    expect((await row(r.id))?.updatedAt.toISOString()).toBe(FIXED_NOW.toISOString());
  });

  it.each([
    ['empty body', {}],
    ['blank text', { text: '   ' }],
    ['empty text', { text: '' }],
    ['too-long text', { text: 'x'.repeat(201) }],
    ['non-string text', { text: 5 }],
    ['too-long person', { person: 'x'.repeat(81) }],
    ['non-string person', { person: 5 }],
    ['non-boolean acknowledged', { acknowledged: 'yes' }],
    ['null acknowledged', { acknowledged: null }],
    ['due as a string', { due: '2026-10-09' }],
    ['due without date', { due: { time: '10:00' } }],
    ['malformed date', { due: { date: '09/10/2026' } }],
    ['impossible date', { due: { date: '2026-02-31' } }],
    ['malformed time', { due: { date: '2026-10-09', time: '5pm' } }],
    ['impossible time', { due: { date: '2026-10-09', time: '25:00' } }],
    ['date far in the future', { due: { date: '2500-01-01' } }],
    ['date far in the past', { due: { date: '1970-01-01' } }],
    ['unknown key inside due', { due: { date: '2026-10-09', zone: 'UTC' } }],
  ])('rejects %s with 422 and changes nothing', async (_name, body) => {
    const { patch, r } = await one({ person: 'John' });
    const res = await patch(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await row(r.id)).toMatchObject({
      content: 'Send the invoice',
      person: 'John',
      dueAt: null,
      status: 'pending',
      userModified: false,
    });
  });

  it.each([
    ['user_id', { user_id: NIL_UUID }],
    ['userId', { userId: NIL_UUID }],
    ['source_note_id', { source_note_id: NIL_UUID }],
    ['sourceNoteId', { sourceNoteId: NIL_UUID }],
    ['ai_fingerprint', { ai_fingerprint: 'forged' }],
    ['aiFingerprint', { aiFingerprint: 'forged' }],
    ['created_by_ai', { created_by_ai: true }],
    ['createdByAi', { createdByAi: true }],
    ['user_modified', { userModified: false }],
    ['status', { status: 'dismissed' }],
    ['alertedAt', { alertedAt: '2000-01-01T00:00:00Z' }],
    ['id', { id: NIL_UUID }],
    ['createdAt', { createdAt: '2000-01-01T00:00:00Z' }],
    ['dueAt (raw instant)', { dueAt: '2026-10-09T00:00:00Z' }],
    ['content (internal column name)', { content: 'sneaky' }],
  ])('rejects the forbidden field %s and changes nothing', async (_name, extra) => {
    const { patch, r, u } = await one();
    const res = await patch({ text: 'ok', ...extra });
    expect(res.status).toBe(422);
    expect(await row(r.id)).toMatchObject({
      content: 'Send the invoice',
      userId: u.user.id,
      aiFingerprint: null,
      createdByAi: false,
      status: 'pending',
    });
  });

  it("cannot move a reminder to another user's note (source_note_id injection)", async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const noteA = await seedNote(a.user.id, 'A note');
    const noteB = await seedNote(b.user.id, 'B note');
    const r = await seedReminder(a.user.id, noteA.id);
    const res = await request(app)
      .patch(`/api/reminders/${r.id}`)
      .set('Cookie', a.cookie)
      .send({ source_note_id: noteB.id, text: 'x' });
    expect(res.status).toBe(422);
    expect((await row(r.id))?.sourceNoteId).toBe(noteA.id);
    // the database itself refuses a cross-owner reference
    await expect(
      db.update(reminders).set({ sourceNoteId: noteB.id }).where(eq(reminders.id, r.id)),
    ).rejects.toThrow();
  });

  it('cannot edit or acknowledge another user’s reminder, which stays untouched', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const r = await seedReminder(a.user.id, (await seedNote(a.user.id)).id, { dueAt: PAST });
    for (const body of [
      { text: 'hijack' },
      { person: 'Mallory' },
      { acknowledged: true },
      { due: { date: '2026-10-09', time: '10:00' } },
    ]) {
      const res = await request(app)
        .patch(`/api/reminders/${r.id}`)
        .set('Cookie', b.cookie)
        .send(body);
      expect(res.status).toBe(404);
    }
    expect(await row(r.id)).toMatchObject({
      content: 'Send the invoice',
      person: null,
      status: 'pending',
      userId: a.user.id,
    });
  });

  it('returns 404 for missing or malformed ids', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    for (const id of [NIL_UUID, 'garbage']) {
      const res = await request(app)
        .patch(`/api/reminders/${id}`)
        .set('Cookie', u.cookie)
        .send({ text: 'x' });
      expect(res.status).toBe(404);
    }
  });

  it('blocks cross-origin writes', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const r = await seedReminder(u.user.id, (await seedNote(u.user.id)).id);
    const res = await request(app)
      .patch(`/api/reminders/${r.id}`)
      .set('Cookie', u.cookie)
      .set('Origin', 'https://evil.example')
      .send({ acknowledged: true });
    expect(res.status).toBe(403);
    expect((await row(r.id))?.status).toBe('pending');
  });
});

describe('DELETE /api/reminders/:id', () => {
  it('deletes the caller’s reminder (204) and it is gone', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const r = await seedReminder(u.user.id, (await seedNote(u.user.id)).id);
    expect(
      (await request(app).delete(`/api/reminders/${r.id}`).set('Cookie', u.cookie)).status,
    ).toBe(204);
    expect(await row(r.id)).toBeUndefined();
    expect((await request(app).get(`/api/reminders/${r.id}`).set('Cookie', u.cookie)).status).toBe(
      404,
    );
    expect(
      (await request(app).delete(`/api/reminders/${r.id}`).set('Cookie', u.cookie)).status,
    ).toBe(404);
  });

  it('does not delete the source note', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    const r = await seedReminder(u.user.id, note.id);
    await request(app).delete(`/api/reminders/${r.id}`).set('Cookie', u.cookie);
    expect(await db.select().from(notes).where(eq(notes.id, note.id))).toHaveLength(1);
  });

  it('cannot delete another user’s reminder; only the caller’s own data is affected', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const rA = await seedReminder(a.user.id, (await seedNote(a.user.id)).id, { content: 'A' });
    const rB = await seedReminder(b.user.id, (await seedNote(b.user.id)).id, { content: 'B' });
    const res = await request(app).delete(`/api/reminders/${rA.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
    expect((await db.select().from(reminders)).map((r) => r.id).sort()).toEqual(
      [rA.id, rB.id].sort(),
    );
    expect(await db.select().from(aiDismissed)).toHaveLength(0);
  });

  it('returns 404 for a malformed id', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    expect((await request(app).delete('/api/reminders/xyz').set('Cookie', u.cookie)).status).toBe(
      404,
    );
  });

  it('records a tombstone for an AI-created reminder, but not for a manual one', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    const aiR = await seedReminder(u.user.id, note.id, {
      createdByAi: true,
      aiFingerprint: 'fp-r1',
    });
    const manual = await seedReminder(u.user.id, note.id, { content: 'manual' });
    await request(app).delete(`/api/reminders/${aiR.id}`).set('Cookie', u.cookie);
    await request(app).delete(`/api/reminders/${manual.id}`).set('Cookie', u.cookie);
    const stones = await db.select().from(aiDismissed);
    expect(stones).toHaveLength(1);
    expect(stones[0]).toMatchObject({
      userId: u.user.id,
      sourceNoteId: note.id,
      kind: 'reminder',
      aiFingerprint: 'fp-r1',
    });
  });

  it('a deleted AI reminder does not come back when the note is edited and re-analysed', async () => {
    const { app, ai } = setup();
    const call = reply(
      item({ kind: 'reminder', text: 'Call mum', evidence: 'remind me to call mum' }),
    );
    ai.respondWith(call, call);
    const u = await createUserWithSession(db);
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'T', content: 'remind me to call mum' });
    const [r] = await db.select().from(reminders);
    await request(app).delete(`/api/reminders/${r?.id}`).set('Cookie', u.cookie);
    await request(app)
      .patch(`/api/notes/${created.body.note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: 'remind me to call mum tonight' });
    expect(await db.select().from(reminders)).toHaveLength(0);
  });
});

describe('interaction with re-analysis (Phase 3 semantics preserved)', () => {
  async function createWithReminder() {
    const { app, ai } = setup();
    ai.respondWith(
      reply(
        item({
          kind: 'reminder',
          text: 'Call mum',
          evidence: 'remind me to call mum at 5pm on 9 oct',
          due_kind: 'datetime',
          due_expression: 'at 5pm on 9 oct',
          due_local: '2026-10-09T17:00',
        }),
      ),
      reply(),
    );
    const u = await createUserWithSession(db);
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'T', content: 'remind me to call mum at 5pm on 9 oct' });
    const [r] = await db.select().from(reminders);
    return { app, u, noteId: created.body.note.id as string, reminderId: r?.id ?? '' };
  }

  it('a user-edited reminder survives a note edit that no longer mentions it', async () => {
    const { app, u, noteId, reminderId } = await createWithReminder();
    await request(app)
      .patch(`/api/reminders/${reminderId}`)
      .set('Cookie', u.cookie)
      .send({ text: 'Call mum on her birthday', person: 'Mum' });
    await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Cookie', u.cookie)
      .send({ content: 'nothing here now' });
    const after = await db.select().from(reminders);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ content: 'Call mum on her birthday', person: 'Mum' });
  });

  it('an acknowledged reminder survives a note edit that no longer mentions it', async () => {
    const { app, u, noteId, reminderId } = await createWithReminder();
    await request(app)
      .patch(`/api/reminders/${reminderId}`)
      .set('Cookie', u.cookie)
      .send({ acknowledged: true });
    await request(app)
      .patch(`/api/notes/${noteId}`)
      .set('Cookie', u.cookie)
      .send({ content: 'nothing here now' });
    expect(await db.select().from(reminders)).toHaveLength(1);
  });

  it('the note view reports an up-to-date reminder count after a reminder is deleted', async () => {
    const { app, u, noteId, reminderId } = await createWithReminder();
    expect(
      (await request(app).get(`/api/notes/${noteId}`).set('Cookie', u.cookie)).body.note.analysis
        .reminders,
    ).toBe(1);
    await request(app).delete(`/api/reminders/${reminderId}`).set('Cookie', u.cookie);
    expect(
      (await request(app).get(`/api/notes/${noteId}`).set('Cookie', u.cookie)).body.note.analysis
        .reminders,
    ).toBe(0);
  });
});
