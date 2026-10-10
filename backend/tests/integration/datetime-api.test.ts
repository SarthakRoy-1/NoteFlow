import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notes, reminders, todos } from '../../src/db/schema.js';
import { FakeAI, item, reply } from '../helpers/fakeAi.js';
import {
  FIXED_NOW,
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

/**
 * Phase 7: what the API stores and returns for dates and times, asserted as UTC instants.
 * The browser never sends instants: it sends the user's local date/time and the server converts it
 * in the account timezone.
 */
const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const KOLKATA = 'Asia/Kolkata';
const NY = 'America/New_York';

async function world(timezone: string, nowAt: { at: number } = { at: FIXED_NOW.getTime() }) {
  const ai = new FakeAI();
  const app = buildApp(db, testEnv(), undefined, { ai, now: () => new Date(nowAt.at) });
  const u = await createUserWithSession(db, { timezone });
  const [note] = await db
    .insert(notes)
    .values({ userId: u.user.id, title: 'Source', content: 'c', analysisStatus: 'ok' })
    .returning();
  const [todo] = await db
    .insert(todos)
    .values({ userId: u.user.id, sourceNoteId: note!.id, title: 'A todo' })
    .returning();
  const [reminder] = await db
    .insert(reminders)
    .values({ userId: u.user.id, sourceNoteId: note!.id, content: 'A reminder' })
    .returning();
  const patchTodo = (body: object) =>
    request(app).patch(`/api/todos/${todo!.id}`).set('Cookie', u.cookie).send(body);
  const patchReminder = (body: object) =>
    request(app).patch(`/api/reminders/${reminder!.id}`).set('Cookie', u.cookie).send(body);
  const getDue = () => request(app).get('/api/reminders/due').set('Cookie', u.cookie);
  return {
    ai,
    app,
    u,
    note: note!,
    todo: todo!,
    reminder: reminder!,
    patchTodo,
    patchReminder,
    getDue,
  };
}

describe('Asia/Kolkata (the development account’s zone)', () => {
  it('stores 2026-10-09 17:00 as 11:30 UTC for todos and reminders, and returns it unchanged', async () => {
    const w = await world(KOLKATA);
    const due = { date: '2026-10-09', time: '17:00' };

    const t = await w.patchTodo({ due });
    expect(t.body.todo).toMatchObject({ dueAt: '2026-10-09T11:30:00.000Z', dueHasTime: true });
    const r = await w.patchReminder({ due });
    expect(r.body.reminder).toMatchObject({ dueAt: '2026-10-09T11:30:00.000Z', dueHasTime: true });

    const again = await request(w.app).get(`/api/todos/${w.todo.id}`).set('Cookie', w.u.cookie);
    expect(again.body.todo.dueAt).toBe('2026-10-09T11:30:00.000Z');
  });

  it('a reminder cannot be given a date without a time (nothing is invented)', async () => {
    const w = await world(KOLKATA);
    const r = await w.patchReminder({ due: { date: '2026-10-09' } });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/needs a time/i);
  });

  it('a reminder at local midnight is stored as midnight, with a time', async () => {
    const w = await world(KOLKATA);
    const r = await w.patchReminder({ due: { date: '2026-10-09', time: '00:00' } });
    expect(r.body.reminder).toMatchObject({ dueAt: '2026-10-08T18:30:00.000Z', dueHasTime: true });
  });

  it('a date-only todo is due by the end of the local day and has no time', async () => {
    const w = await world(KOLKATA);
    const t = await w.patchTodo({ due: { date: '2026-10-09' } });
    expect(t.body.todo).toMatchObject({ dueAt: '2026-10-09T18:29:59.999Z', dueHasTime: false });
  });

  it('local midnight and 23:59 land on different UTC days', async () => {
    const w = await world(KOLKATA);
    expect(
      (await w.patchTodo({ due: { date: '2026-10-09', time: '00:00' } })).body.todo.dueAt,
    ).toBe('2026-10-08T18:30:00.000Z');
    expect(
      (await w.patchTodo({ due: { date: '2026-10-09', time: '23:59' } })).body.todo.dueAt,
    ).toBe('2026-10-09T18:29:00.000Z');
  });

  it('works with the legacy id Asia/Calcutta that Google/browsers may report', async () => {
    const w = await world('Asia/Calcutta');
    const t = await w.patchTodo({ due: { date: '2026-10-09', time: '17:00' } });
    expect(t.body.todo.dueAt).toBe('2026-10-09T11:30:00.000Z');
  });
});

describe('daylight saving through the API (America/New_York)', () => {
  it('spring forward: instants either side of the change use different offsets', async () => {
    const w = await world(NY);
    const at = async (time: string) =>
      (await w.patchTodo({ due: { date: '2026-03-08', time } })).body.todo.dueAt;
    expect(await at('01:59')).toBe('2026-03-08T06:59:00.000Z'); // EST
    expect(await at('03:00')).toBe('2026-03-08T07:00:00.000Z'); // EDT, one minute of real time later
    expect(await at('02:30')).toBe('2026-03-08T07:30:00.000Z'); // does not exist: moved to 03:30 EDT
  });

  it('fall back: the repeated hour takes its first occurrence', async () => {
    const w = await world(NY);
    const at = async (time: string) =>
      (await w.patchTodo({ due: { date: '2026-11-01', time } })).body.todo.dueAt;
    expect(await at('01:30')).toBe('2026-11-01T05:30:00.000Z'); // EDT
    expect(await at('02:00')).toBe('2026-11-01T07:00:00.000Z'); // EST
  });

  it('midnight and date-only values follow the real length of the day', async () => {
    const w = await world(NY);
    const spring = await w.patchReminder({ due: { date: '2026-03-08', time: '00:00' } });
    expect(spring.body.reminder.dueAt).toBe('2026-03-08T05:00:00.000Z');
    const fall = await w.patchReminder({ due: { date: '2026-11-01', time: '00:00' } });
    expect(fall.body.reminder.dueAt).toBe('2026-11-01T04:00:00.000Z');
    const todoSpring = await w.patchTodo({ due: { date: '2026-03-08' } });
    expect(todoSpring.body.todo.dueAt).toBe('2026-03-09T03:59:59.999Z');
  });

  it('a leap day is accepted and a missing one is refused', async () => {
    const w = await world(NY);
    expect((await w.patchTodo({ due: { date: '2028-02-29', time: '12:00' } })).status).toBe(200);
    const bad = await w.patchTodo({ due: { date: '2027-02-29' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/not a valid due date/i);
  });
});

describe('reminder alerts at the exact instant, across a DST change', () => {
  it('a 03:30 EDT reminder on the spring-forward day alerts at 07:30:00Z, not a second earlier', async () => {
    const clock = { at: Date.parse('2026-03-08T07:29:59.999Z') };
    const w = await world(NY, clock);
    await w.patchReminder({ due: { date: '2026-03-08', time: '03:30' } });

    const before = await w.getDue();
    expect(before.body.reminders).toEqual([]);
    expect(before.body.nextDueAt).toBe('2026-03-08T07:30:00.000Z');

    clock.at = Date.parse('2026-03-08T07:30:00.000Z');
    const at = await w.getDue();
    expect(at.body.reminders.map((r: { id: string }) => r.id)).toEqual([w.reminder.id]);
    expect(at.body.nextDueAt).toBeNull();
  });

  it('a midnight reminder alerts at local midnight, across the fall-back day', async () => {
    const clock = { at: Date.parse('2026-11-01T03:59:59.999Z') }; // one ms before midnight EDT
    const w = await world(NY, clock);
    await w.patchReminder({ due: { date: '2026-11-01', time: '00:00' } });
    expect((await w.getDue()).body.reminders).toEqual([]);

    clock.at = Date.parse('2026-11-01T04:00:00.000Z');
    const due = await w.getDue();
    expect(due.body.reminders[0]).toMatchObject({
      dueAt: '2026-11-01T04:00:00.000Z',
      dueHasTime: true,
    });
  });

  it('Kolkata: an 09:00 local reminder is not due at 03:29Z but is at 03:30Z', async () => {
    const clock = { at: Date.parse('2026-10-09T03:29:59.999Z') };
    const w = await world(KOLKATA, clock);
    await w.patchReminder({ due: { date: '2026-10-09', time: '09:00' } });
    expect((await w.getDue()).body.reminders).toEqual([]);
    clock.at = Date.parse('2026-10-09T03:30:00.000Z');
    expect((await w.getDue()).body.reminders).toHaveLength(1);
  });

  it('a reminder with no date never alerts', async () => {
    const w = await world(KOLKATA);
    expect((await w.getDue()).body).toEqual({ reminders: [], nextDueAt: null });
  });
});

describe('AI-created dates keep the account timezone through the whole save', () => {
  it('a note saved by a Kolkata user stores the extracted time as UTC', async () => {
    const w = await world(KOLKATA);
    w.ai.respondWith(
      reply(
        item({
          kind: 'reminder',
          text: 'Call mum',
          evidence: 'call mum tomorrow at 6pm',
          due_kind: 'datetime',
          due_expression: 'tomorrow at 6pm',
          due_local: '2026-10-09T18:00',
        }),
        item({
          kind: 'todo',
          text: 'Pay rent',
          evidence: 'pay rent tomorrow',
          due_kind: 'date',
          due_expression: 'tomorrow',
          due_local: '2026-10-09',
        }),
      ),
    );
    const res = await request(w.app)
      .post('/api/notes')
      .set('Cookie', w.u.cookie)
      .send({ title: 'Plans', content: 'call mum tomorrow at 6pm and pay rent tomorrow' });
    expect(res.body.note.analysis.status).toBe('ok');

    const [r] = (await db.select().from(reminders)).filter((x) => x.content === 'Call mum');
    expect(r?.dueAt?.toISOString()).toBe('2026-10-09T12:30:00.000Z');
    expect(r?.dueHasTime).toBe(true);
    const [t] = (await db.select().from(todos)).filter((x) => x.title === 'Pay rent');
    expect(t?.dueAt?.toISOString()).toBe('2026-10-09T18:29:59.999Z');
    expect(t?.dueHasTime).toBe(false);
  });
});

describe('date/time fields cannot carry ownership or raw timestamps', () => {
  const forbidden: [string, object][] = [
    ['a raw dueAt', { dueAt: '2026-10-09T11:30:00.000Z' }],
    ['a raw due_at', { due_at: '2026-10-09T11:30:00.000Z' }],
    ['dueHasTime', { dueHasTime: true }],
    ['a timezone', { timezone: 'UTC' }],
    ['a user_id beside a due date', { due: { date: '2026-10-09' }, user_id: '0' }],
    ['a raw timestamp inside due', { due: { date: '2026-10-09', dueAt: '2026-10-09T00:00:00Z' } }],
    ['an offset inside due', { due: { date: '2026-10-09', time: '17:00', offset: '+05:30' } }],
    ['an ISO instant as the date', { due: { date: '2026-10-09T11:30:00Z' } }],
    ['a time with seconds', { due: { date: '2026-10-09', time: '17:00:00' } }],
    ['hour 24', { due: { date: '2026-10-09', time: '24:00' } }],
    ['a non-object due', { due: '2026-10-09' }],
  ];

  it.each(forbidden)('todos refuse %s and change nothing', async (_n, body) => {
    const w = await world(KOLKATA);
    const res = await w.patchTodo(body);
    expect(res.status).toBe(422);
    const [row] = await db.select().from(todos);
    expect(row?.dueAt).toBeNull();
  });

  it.each(forbidden)('reminders refuse %s and change nothing', async (_n, body) => {
    const w = await world(KOLKATA);
    const res = await w.patchReminder(body);
    expect(res.status).toBe(422);
    const [row] = await db.select().from(reminders);
    expect(row?.dueAt).toBeNull();
  });

  it('PATCH /api/me refuses a bad timezone and a user_id, and keeps the stored zone', async () => {
    const w = await world(KOLKATA);
    for (const body of [
      { timezone: 'Mars/Olympus' },
      { timezone: 'EST' },
      { timezone: '' },
      { timezone: 'Asia/Kolkata', user_id: w.u.user.id },
    ]) {
      const res = await request(w.app).patch('/api/me').set('Cookie', w.u.cookie).send(body);
      expect(res.status).toBe(422);
    }
    const me = await request(w.app).get('/api/me').set('Cookie', w.u.cookie);
    expect(me.body.user.timezone).toBe(KOLKATA);
  });

  it('changing the account timezone changes how a typed time is stored from then on', async () => {
    const w = await world(KOLKATA);
    await request(w.app).patch('/api/me').set('Cookie', w.u.cookie).send({ timezone: NY });
    const t = await w.patchTodo({ due: { date: '2026-10-09', time: '17:00' } });
    expect(t.body.todo.dueAt).toBe('2026-10-09T21:00:00.000Z');
  });
});
