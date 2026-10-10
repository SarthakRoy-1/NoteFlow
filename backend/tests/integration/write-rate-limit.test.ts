import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeAI } from '../helpers/fakeAi.js';
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

function setup(writesPerMinute: number) {
  const clock = { at: FIXED_NOW };
  const app = buildApp(db, testEnv(), undefined, {
    ai: new FakeAI(),
    now: () => clock.at,
    writesPerMinute,
    aiCallsPerMinute: 1000,
  });
  return { app, clock };
}

describe('per-user limit on state-changing requests', () => {
  it('answers 429 once a user exceeds it, across different endpoints', async () => {
    const { app } = setup(4);
    const u = await createUserWithSession(db);
    const statuses: number[] = [];
    statuses.push(
      (await request(app).patch('/api/me').set('Cookie', u.cookie).send({ timezone: 'UTC' }))
        .status,
    );
    statuses.push(
      (
        await request(app)
          .post('/api/notes')
          .set('Cookie', u.cookie)
          .send({ title: 'One', content: 'first' })
      ).status,
    );
    statuses.push(
      (
        await request(app)
          .post('/api/notes')
          .set('Cookie', u.cookie)
          .send({ title: 'Two', content: 'second' })
      ).status,
    );
    statuses.push(
      (await request(app).post('/api/ask').set('Cookie', u.cookie).send({ question: 'x?' })).status,
    );
    expect(statuses).toEqual([200, 201, 201, 201]);

    const blocked = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Three', content: 'third' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(JSON.stringify(blocked.body)).not.toMatch(/stack|Error:/);
  });

  it('never limits reads', async () => {
    const { app } = setup(1);
    const u = await createUserWithSession(db);
    await request(app).patch('/api/me').set('Cookie', u.cookie).send({ timezone: 'UTC' });
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get('/api/notes').set('Cookie', u.cookie)).status).toBe(200);
      expect((await request(app).get('/api/reminders/due').set('Cookie', u.cookie)).status).toBe(
        200,
      );
    }
  });

  it('is per user: one user hitting it does not slow another', async () => {
    const { app } = setup(1);
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await request(app).patch('/api/me').set('Cookie', a.cookie).send({ timezone: 'UTC' });
    const blocked = await request(app)
      .patch('/api/me')
      .set('Cookie', a.cookie)
      .send({ timezone: 'UTC' });
    expect(blocked.status).toBe(429);
    const other = await request(app)
      .patch('/api/me')
      .set('Cookie', b.cookie)
      .send({ timezone: 'UTC' });
    expect(other.status).toBe(200);
  });

  it('recovers after the window passes', async () => {
    const { app, clock } = setup(1);
    const u = await createUserWithSession(db);
    await request(app).patch('/api/me').set('Cookie', u.cookie).send({ timezone: 'UTC' });
    expect(
      (await request(app).patch('/api/me').set('Cookie', u.cookie).send({ timezone: 'UTC' }))
        .status,
    ).toBe(429);
    clock.at = new Date(FIXED_NOW.getTime() + 61_000);
    expect(
      (await request(app).patch('/api/me').set('Cookie', u.cookie).send({ timezone: 'UTC' }))
        .status,
    ).toBe(200);
  });

  it('does not apply to signed-out requests (they are rejected before it)', async () => {
    const { app } = setup(1);
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/notes').send({ title: 'a', content: 'b' });
      expect(res.status).toBe(401);
    }
  });
});
