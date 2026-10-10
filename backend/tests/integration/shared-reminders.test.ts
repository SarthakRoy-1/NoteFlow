import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notes, reminderShares, reminders, users } from '../../src/db/schema.js';
import { FakeAI } from '../helpers/fakeAi.js';
import {
  FIXED_NOW,
  buildApp,
  createPasswordUserWithSession,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const NIL_UUID = '00000000-0000-4000-8000-000000000000';
const NOTE_TITLE = 'PRIVATE-NOTE-TITLE-7741';
const NOTE_BODY = 'PRIVATE-NOTE-BODY-7741 contains the whole plan';

function setup() {
  const clock = { at: FIXED_NOW };
  const app = buildApp(db, testEnv(), undefined, { ai: new FakeAI(), now: () => clock.at });
  return { app, clock };
}

async function seedReminder(
  userId: string,
  partial: Partial<typeof reminders.$inferInsert> = {},
  noteTitle = NOTE_TITLE,
) {
  const [n] = await db
    .insert(notes)
    .values({ userId, title: noteTitle, content: NOTE_BODY, analysisStatus: 'ok' })
    .returning();
  if (!n) throw new Error('seed failed');
  const [r] = await db
    .insert(reminders)
    .values({
      userId,
      sourceNoteId: n.id,
      content: 'Send the invoice',
      person: 'John',
      dueAt: new Date('2026-10-09T11:30:00Z'),
      dueHasTime: true,
      ...partial,
    })
    .returning();
  if (!r) throw new Error('seed failed');
  return { note: n, reminder: r };
}

async function threeUsers() {
  const a = await createUserWithSession(db, { email: 'a@example.com', timezone: 'Asia/Kolkata' });
  const b = await createUserWithSession(db, { email: 'b@example.com', timezone: 'Asia/Kolkata' });
  const c = await createUserWithSession(db, { email: 'c@example.com', timezone: 'Asia/Kolkata' });
  return { a, b, c };
}

const share = (
  app: ReturnType<typeof setup>['app'],
  cookie: string,
  reminderId: string,
  body: unknown,
) =>
  request(app)
    .post(`/api/reminders/${reminderId}/shares`)
    .set('Cookie', cookie)
    .send(body as object);

const shared = (app: ReturnType<typeof setup>['app'], cookie: string) =>
  request(app).get('/api/shared-reminders').set('Cookie', cookie);

describe('authentication required', () => {
  it('rejects every sharing endpoint without a session', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const results = await Promise.all([
      request(app).post(`/api/reminders/${reminder.id}/shares`).send({ email: 'b@example.com' }),
      request(app).get(`/api/reminders/${reminder.id}/shares`),
      request(app).delete(`/api/reminders/${reminder.id}/shares/${NIL_UUID}`),
      request(app).get('/api/shared-reminders'),
      request(app).patch(`/api/shared-reminders/${NIL_UUID}`).send({ acknowledged: true }),
      request(app).delete(`/api/shared-reminders/${NIL_UUID}`),
    ]);
    for (const res of results) expect(res.status).toBe(401);
    expect(await db.select().from(reminderShares)).toHaveLength(0);
  });
});

describe('sharing with a valid recipient', () => {
  it('resolves the email (any case) to a real user and notifies only them', async () => {
    const { app } = setup();
    const { a, b, c } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);

    const res = await share(app, a.cookie, reminder.id, { email: '  B@Example.COM ' });
    expect(res.status).toBe(201);
    expect(res.body.share).toMatchObject({
      recipient: { name: 'b', email: 'b@example.com' },
      acknowledgedAt: null,
    });

    const [row] = await db.select().from(reminderShares);
    expect(row).toMatchObject({
      reminderId: reminder.id,
      ownerId: a.user.id,
      recipientId: b.user.id,
    });

    const forB = await shared(app, b.cookie);
    expect(forB.status).toBe(200);
    expect(forB.body.shared).toHaveLength(1);
    expect(forB.body.shared[0]).toMatchObject({
      id: res.body.share.id,
      text: 'Send the invoice',
      dueAt: '2026-10-09T11:30:00.000Z',
      dueHasTime: true,
      recurrence: null,
      from: { name: 'a' },
      isNew: true,
      due: false,
    });

    // Nobody else is notified.
    expect((await shared(app, c.cookie)).body.shared).toEqual([]);
    expect((await shared(app, a.cookie)).body.shared).toEqual([]);
  });

  it('shows the recipient only the shared reminder, never the note or the sender’s identity', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder, note } = await seedReminder(a.user.id);
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });

    const res = await shared(app, b.cookie);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(NOTE_TITLE);
    expect(text).not.toContain(NOTE_BODY);
    expect(text).not.toContain(note.id);
    expect(text).not.toContain(reminder.id);
    expect(text).not.toContain('a@example.com');
    expect(text).not.toContain(a.user.id);
    expect(text).not.toContain('John'); // the person field is not part of what is shared
    expect(Object.keys(res.body.shared[0]).sort()).toEqual(
      [
        'acknowledgedAt',
        'due',
        'dueAt',
        'dueHasTime',
        'from',
        'id',
        'isNew',
        'occurrenceAt',
        'recurrence',
        'sharedAt',
        'text',
      ].sort(),
    );
  });

  it('is idempotent: sharing twice keeps one share', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const first = await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    const second = await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.share.id).toBe(first.body.share.id);
    expect(await db.select().from(reminderShares)).toHaveLength(1);
  });

  it('lets the owner see who a reminder is shared with, in the list and per reminder', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const made = await share(app, a.cookie, reminder.id, { email: 'b@example.com' });

    const list = await request(app).get('/api/reminders').set('Cookie', a.cookie);
    expect(list.body.reminders[0].sharedWith).toEqual([
      { shareId: made.body.share.id, name: 'b', email: 'b@example.com' },
    ]);
    const one = await request(app)
      .get(`/api/reminders/${reminder.id}/shares`)
      .set('Cookie', a.cookie);
    expect(one.body.shares).toHaveLength(1);
  });
});

describe('recipients that cannot be notified', () => {
  it('rejects an unknown email as "not found" and creates nothing', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const res = await share(app, a.cookie, reminder.id, { email: 'nobody@example.com' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RECIPIENT_NOT_FOUND');
    expect(await db.select().from(reminderShares)).toHaveLength(0);
  });

  it('rejects an account whose email was never verified', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    await createPasswordUserWithSession(db, { email: 'unverified@example.com', verified: false });
    const { reminder } = await seedReminder(a.user.id);
    const res = await share(app, a.cookie, reminder.id, { email: 'unverified@example.com' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RECIPIENT_NOT_FOUND');
  });

  it('rejects sharing with yourself', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const res = await share(app, a.cookie, reminder.id, { email: 'a@example.com' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANNOT_SHARE_WITH_SELF');
  });

  it.each([
    ['a display name instead of an email', { name: 'Bee' }],
    ['a display name as the email', { email: 'Bee' }],
    ['a forged recipient id', { email: 'b@example.com', recipient_id: NIL_UUID }],
    ['a forged recipientId', { email: 'b@example.com', recipientId: NIL_UUID }],
    ['a forged user_id', { email: 'b@example.com', user_id: NIL_UUID }],
    ['a forged owner', { email: 'b@example.com', owner_id: NIL_UUID }],
    ['only a recipient id', { recipient_id: NIL_UUID }],
    ['an empty email', { email: '' }],
    ['a numeric email', { email: 5 }],
    ['an array email', { email: ['b@example.com'] }],
    ['an email with a NUL', { email: 'b@example.com\u0000' }],
    ['an oversized email', { email: `${'a'.repeat(250)}@example.com` }],
    ['an empty body', {}],
  ])('rejects %s with 422 and creates nothing', async (_name, body) => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const res = await share(app, a.cookie, reminder.id, body);
    expect(res.status).toBe(422);
    expect(await db.select().from(reminderShares)).toHaveLength(0);
  });
});

describe('who may do what', () => {
  it('only the owner can share a reminder; a non-owner learns nothing about accounts', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);

    // B does not own it: "not found", whether or not the recipient exists.
    for (const email of ['c@example.com', 'nobody@example.com', 'a@example.com']) {
      const res = await share(app, b.cookie, reminder.id, { email });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect(await db.select().from(reminderShares)).toHaveLength(0);
  });

  it('a recipient cannot read, edit, acknowledge or delete the owner’s reminder directly', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });

    const attempts = await Promise.all([
      request(app).get(`/api/reminders/${reminder.id}`).set('Cookie', b.cookie),
      request(app)
        .patch(`/api/reminders/${reminder.id}`)
        .set('Cookie', b.cookie)
        .send({ text: 'hijacked' }),
      request(app)
        .patch(`/api/reminders/${reminder.id}`)
        .set('Cookie', b.cookie)
        .send({ acknowledged: true }),
      request(app).delete(`/api/reminders/${reminder.id}`).set('Cookie', b.cookie),
      request(app).get(`/api/reminders/${reminder.id}/shares`).set('Cookie', b.cookie),
    ]);
    for (const res of attempts) expect(res.status).toBe(404);

    const [row] = await db.select().from(reminders);
    expect(row).toMatchObject({ content: 'Send the invoice', status: 'pending' });
    // And the owner's list (which includes B's name) is not visible to B.
    const list = await request(app).get('/api/reminders').set('Cookie', b.cookie);
    expect(list.body.reminders).toEqual([]);
  });

  it('a recipient cannot revoke the owner’s share, and an unrelated user cannot touch any share', async () => {
    const { app } = setup();
    const { a, b, c } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const made = await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    const shareId = made.body.share.id as string;

    const attempts = await Promise.all([
      request(app)
        .delete(`/api/reminders/${reminder.id}/shares/${shareId}`)
        .set('Cookie', b.cookie),
      request(app)
        .delete(`/api/reminders/${reminder.id}/shares/${shareId}`)
        .set('Cookie', c.cookie),
      request(app)
        .patch(`/api/shared-reminders/${shareId}`)
        .set('Cookie', c.cookie)
        .send({ acknowledged: true }),
      request(app).delete(`/api/shared-reminders/${shareId}`).set('Cookie', c.cookie),
      request(app)
        .patch(`/api/shared-reminders/${shareId}`)
        .set('Cookie', a.cookie) // the owner is not the recipient either
        .send({ acknowledged: true }),
    ]);
    for (const res of attempts) expect(res.status).toBe(404);
    expect(await db.select().from(reminderShares)).toHaveLength(1);
  });

  it.each(['not-a-uuid', '1', "' or 1=1 --", NIL_UUID])(
    'treats share id %j as not found',
    async (id) => {
      const { app } = setup();
      const { a, b } = await threeUsers();
      const { reminder } = await seedReminder(a.user.id);
      const encoded = encodeURIComponent(id);
      expect(
        (
          await request(app)
            .patch(`/api/shared-reminders/${encoded}`)
            .set('Cookie', b.cookie)
            .send({ acknowledged: true })
        ).status,
      ).toBe(404);
      expect(
        (await request(app).delete(`/api/shared-reminders/${encoded}`).set('Cookie', b.cookie))
          .status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .delete(`/api/reminders/${reminder.id}/shares/${encoded}`)
            .set('Cookie', a.cookie)
        ).status,
      ).toBe(404);
    },
  );

  it('rejects unexpected fields when a recipient acknowledges', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const made = await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    for (const body of [{}, { acknowledged: false }, { acknowledged: true, text: 'x' }]) {
      const res = await request(app)
        .patch(`/api/shared-reminders/${made.body.share.id}`)
        .set('Cookie', b.cookie)
        .send(body);
      expect(res.status).toBe(422);
    }
  });

  it('limits how many people one reminder can be shared with', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    for (let i = 0; i < 10; i++) {
      await createUserWithSession(db, { email: `friend${i}@example.com` });
    }
    await createUserWithSession(db, { email: 'extra@example.com' });
    // The per-minute probe limiter is 10; use a fresh clock window by sharing in two batches is not
    // possible with a fixed clock, so seed nine shares directly and add the last two via the API.
    const friends = await db.select().from(users);
    const recipients = friends.filter((u) => u.email.startsWith('friend')).slice(0, 9);
    await db
      .insert(reminderShares)
      .values(
        recipients.map((u) => ({ reminderId: reminder.id, ownerId: a.user.id, recipientId: u.id })),
      );
    const tenth = await share(app, a.cookie, reminder.id, { email: 'friend9@example.com' });
    expect([200, 201]).toContain(tenth.status);
    const eleventh = await share(app, a.cookie, reminder.id, { email: 'extra@example.com' });
    expect(eleventh.status).toBe(422);
    expect(eleventh.body.error.code).toBe('SHARE_LIMIT');
  });

  it('rate-limits probing for accounts by email', async () => {
    const { app } = setup();
    const { a } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await share(app, a.cookie, reminder.id, { email: `ghost${i}@example.com` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('what happens to a share when things change', () => {
  it('shows the recipient the owner’s edits', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });

    await request(app)
      .patch(`/api/reminders/${reminder.id}`)
      .set('Cookie', a.cookie)
      .send({ text: 'Send the final invoice', due: { date: '2026-10-12', time: '10:00' } });
    const res = await shared(app, b.cookie);
    expect(res.body.shared[0]).toMatchObject({
      text: 'Send the final invoice',
      dueAt: '2026-10-12T04:30:00.000Z',
    });
  });

  it('removes the share when the owner deletes the reminder', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    const del = await request(app).delete(`/api/reminders/${reminder.id}`).set('Cookie', a.cookie);
    expect(del.status).toBe(204);
    expect((await shared(app, b.cookie)).body.shared).toEqual([]);
    expect(await db.select().from(reminderShares)).toHaveLength(0);
  });

  it('removes the share when the owner deletes the source note', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder, note } = await seedReminder(a.user.id);
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    await request(app).delete(`/api/notes/${note.id}`).set('Cookie', a.cookie);
    expect((await shared(app, b.cookie)).body.shared).toEqual([]);
  });

  it('stops notifying when the owner revokes the share', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const made = await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    const res = await request(app)
      .delete(`/api/reminders/${reminder.id}/shares/${made.body.share.id}`)
      .set('Cookie', a.cookie);
    expect(res.status).toBe(204);
    expect((await shared(app, b.cookie)).body.shared).toEqual([]);
    // The reminder itself is untouched.
    expect(await db.select().from(reminders)).toHaveLength(1);
  });

  it('lets the recipient remove it from their own list without touching the reminder', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const made = await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    const res = await request(app)
      .delete(`/api/shared-reminders/${made.body.share.id}`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(204);
    expect((await shared(app, b.cookie)).body.shared).toEqual([]);
    const list = await request(app).get('/api/reminders').set('Cookie', a.cookie);
    expect(list.body.reminders).toHaveLength(1);
    expect(list.body.reminders[0].sharedWith).toEqual([]);
  });

  it('removes shares when the recipient’s account is deleted', async () => {
    const { app } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    await db.delete(users).where(eq(users.id, b.user.id));
    expect(await db.select().from(reminderShares)).toHaveLength(0);
    expect(await db.select().from(reminders)).toHaveLength(1);
  });
});

describe('alerting the recipient', () => {
  it('becomes due at the reminder time, is acknowledged independently, and nextDueAt points ahead', async () => {
    const { app, clock } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id, {
      dueAt: new Date('2026-10-09T11:30:00Z'),
    });
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });

    const before = await shared(app, b.cookie);
    expect(before.body.shared[0]).toMatchObject({ due: false, occurrenceAt: null });
    expect(before.body.nextDueAt).toBe('2026-10-09T11:30:00.000Z');

    clock.at = new Date('2026-10-09T11:30:00Z');
    const dueNow = await shared(app, b.cookie);
    expect(dueNow.body.shared[0]).toMatchObject({
      due: true,
      occurrenceAt: '2026-10-09T11:30:00.000Z',
    });

    const done = await request(app)
      .patch(`/api/shared-reminders/${dueNow.body.shared[0].id}`)
      .set('Cookie', b.cookie)
      .send({ acknowledged: true });
    expect(done.status).toBe(200);
    expect(done.body.shared).toMatchObject({ due: false, isNew: false });

    // The owner's own alert is a separate thing and is still pending.
    const own = await request(app).get('/api/reminders/due').set('Cookie', a.cookie);
    expect(own.body.reminders).toHaveLength(1);
  });

  it('a reminder without a time never becomes due for the recipient', async () => {
    const { app, clock } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id, { dueAt: null, dueHasTime: false });
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    clock.at = new Date('2030-01-01T00:00:00Z');
    const res = await shared(app, b.cookie);
    expect(res.body.shared[0]).toMatchObject({ due: false, dueAt: null });
    expect(res.body.nextDueAt).toBeNull();
  });

  it('a repeating reminder alerts the recipient every occurrence, whatever the owner does', async () => {
    const { app, clock } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id, {
      dueAt: new Date('2026-10-12T03:30:00Z'),
      recurrenceDays: [1],
      recurrenceTime: '09:00',
    });
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' }); // shared Thursday 8 Oct

    // Thursday: the next occurrence is ahead.
    const thursday = await shared(app, b.cookie);
    expect(thursday.body.shared[0]).toMatchObject({
      due: false,
      recurrence: { days: [1], time: '09:00' },
    });
    expect(thursday.body.nextDueAt).toBe('2026-10-12T03:30:00.000Z');

    // Monday 12 Oct 09:00 IST: due. B acknowledges.
    clock.at = new Date('2026-10-12T03:30:00Z');
    const monday = await shared(app, b.cookie);
    expect(monday.body.shared[0]).toMatchObject({
      due: true,
      occurrenceAt: '2026-10-12T03:30:00.000Z',
    });
    await request(app)
      .patch(`/api/shared-reminders/${monday.body.shared[0].id}`)
      .set('Cookie', b.cookie)
      .send({ acknowledged: true });
    expect((await shared(app, b.cookie)).body.shared[0].due).toBe(false);

    // The owner never acknowledges, yet B is alerted again next Monday.
    clock.at = new Date('2026-10-19T03:30:00Z');
    const nextMonday = await shared(app, b.cookie);
    expect(nextMonday.body.shared[0]).toMatchObject({
      due: true,
      occurrenceAt: '2026-10-19T03:30:00.000Z',
    });
  });

  it('does not raise an alert for an occurrence that happened before the share existed', async () => {
    const { app, clock } = setup();
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id, {
      dueAt: new Date('2026-10-19T03:30:00Z'),
      recurrenceDays: [1],
      recurrenceTime: '09:00',
    });
    // Shared on Wednesday 14 Oct, after Monday 12 Oct's occurrence.
    clock.at = new Date('2026-10-14T06:30:00Z');
    await share(app, a.cookie, reminder.id, { email: 'b@example.com' });
    const res = await shared(app, b.cookie);
    expect(res.body.shared[0].due).toBe(false);
    expect(res.body.shared[0].isNew).toBe(true);
  });
});

describe('database guarantees', () => {
  it('refuses a share whose owner does not own the reminder, and a self share', async () => {
    const { a, b, c } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    await expect(
      db.insert(reminderShares).values({
        reminderId: reminder.id,
        ownerId: c.user.id, // c does not own it
        recipientId: b.user.id,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(reminderShares).values({
        reminderId: reminder.id,
        ownerId: a.user.id,
        recipientId: a.user.id,
      }),
    ).rejects.toThrow();
    expect(await db.select().from(reminderShares)).toHaveLength(0);
  });

  it('refuses a duplicate share of the same reminder with the same user', async () => {
    const { a, b } = await threeUsers();
    const { reminder } = await seedReminder(a.user.id);
    const row = { reminderId: reminder.id, ownerId: a.user.id, recipientId: b.user.id };
    await db.insert(reminderShares).values(row);
    await expect(db.insert(reminderShares).values(row)).rejects.toThrow();
  });
});
