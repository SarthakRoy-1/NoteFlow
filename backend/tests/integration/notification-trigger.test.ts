import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notificationDeliveries } from '../../src/db/schema.js';
import { seedReminder } from '../helpers/notifications.js';
import {
  FakeEmail,
  FakePush,
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const SECRET = 'cron-secret-0123456789-0123456789-abcdef';
const PATH = '/api/internal/notifications/dispatch';

function app(secret: string | undefined, email = new FakeEmail()) {
  return {
    email,
    app: buildApp(db, testEnv({ NOTIFICATIONS_CRON_SECRET: secret }), undefined, {
      email,
      push: new FakePush(),
    }),
  };
}

describe('POST /api/internal/notifications/dispatch', () => {
  it('does not exist when no secret is configured', async () => {
    const res = await request(app(undefined).app)
      .post(PATH)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(res.status).toBe(404);
  });

  it('refuses a missing, wrong or malformed secret', async () => {
    const { app: a } = app(SECRET);
    const user = await createUserWithSession(db);
    for (const header of [undefined, 'Bearer nope', `Basic ${SECRET}`, SECRET, 'Bearer ']) {
      const req = request(a).post(PATH);
      if (header) req.set('Authorization', header);
      expect((await req).status).toBe(401);
    }
    // A signed-in user's session is not a substitute for the secret.
    const bySession = await request(a).post(PATH).set('Cookie', user.cookie);
    expect(bySession.status).toBe(401);
  });

  it('runs a tick for the right secret and is safe to call repeatedly', async () => {
    const { app: a, email } = app(SECRET);
    const { user } = await createUserWithSession(db, { email: 'owner@example.com' });
    await seedReminder(db, user.id);
    const first = await request(a).post(PATH).set('Authorization', `Bearer ${SECRET}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ enqueued: 1, sent: 1 });
    const second = await request(a).post(PATH).set('Authorization', `Bearer ${SECRET}`);
    expect(second.body).toMatchObject({ enqueued: 0, sent: 0 });
    expect(email.sent).toHaveLength(1);
    expect(await db.select().from(notificationDeliveries)).toHaveLength(1);
  });

  it('cannot be driven from a browser page on another origin', async () => {
    const { app: a } = app(SECRET);
    const res = await request(a)
      .post(PATH)
      .set('Origin', 'https://evil.example')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(res.status).toBe(403);
  });

  it('returns only counts, never recipients or reminder text', async () => {
    const { app: a } = app(SECRET);
    const { user } = await createUserWithSession(db, { email: 'owner@example.com' });
    await seedReminder(db, user.id);
    const res = await request(a).post(PATH).set('Authorization', `Bearer ${SECRET}`);
    expect(Object.keys(res.body).sort()).toEqual(
      ['enqueued', 'failed', 'retried', 'sent', 'skipped'].sort(),
    );
  });
});
