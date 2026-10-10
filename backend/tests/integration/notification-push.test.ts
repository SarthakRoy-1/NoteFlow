import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  notificationDeliveries,
  notificationPreferences,
  pushSubscriptions,
  reminderShares,
} from '../../src/db/schema.js';
import { isAllowedPushEndpoint } from '../../src/notifications/push.js';
import { NOTE_TITLE, seedReminder, tick, DUE_AT } from '../helpers/notifications.js';
import {
  FIXED_NOW,
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

const MINUTE = 60_000;
const after = (ms: number) => new Date(FIXED_NOW.getTime() + ms);

// A real-looking subscription: 65-byte P-256 key and 16-byte auth secret, base64url.
const P256DH = Buffer.alloc(65, 7).toString('base64url');
const AUTH = Buffer.alloc(16, 9).toString('base64url');
const endpoint = (n: number | string) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const subscription = (n: number | string = 1, extra: object = {}) => ({
  endpoint: endpoint(n),
  keys: { p256dh: P256DH, auth: AUTH },
  ...extra,
});

function setup(push = new FakePush()) {
  const app = buildApp(db, testEnv(), undefined, { push, email: new FakeEmail() });
  return { app, push };
}
const api = (app: ReturnType<typeof setup>['app'], cookie: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', cookie),
  post: (path: string, body: object) => request(app).post(path).set('Cookie', cookie).send(body),
  patch: (path: string, body: object) => request(app).patch(path).set('Cookie', cookie).send(body),
  del: (path: string) => request(app).delete(path).set('Cookie', cookie),
});

describe('push endpoint allow-list', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/?token=abc',
  ])('accepts %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://internal.service.local/hook',
    'https://evil.example.com/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x', // look-alike suffix
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'ftp://fcm.googleapis.com/x',
    'not a url',
  ])('refuses %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(false));
});

describe('notification settings API', () => {
  it('requires authentication on every route', async () => {
    const { app } = setup();
    const id = '00000000-0000-4000-8000-000000000000';
    const results = await Promise.all([
      request(app).get('/api/notifications'),
      request(app).patch('/api/notifications').send({ emailEnabled: false }),
      request(app).post('/api/notifications/push-subscriptions').send(subscription()),
      request(app).delete(`/api/notifications/push-subscriptions/${id}`),
    ]);
    for (const res of results) expect(res.status).toBe(401);
  });

  it('reports sensible defaults and what this server can do', async () => {
    const { app } = setup();
    const { cookie } = await createUserWithSession(db);
    const res = await api(app, cookie).get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: { available: true, enabled: true },
      push: {
        available: true,
        enabled: true,
        showText: false,
        publicKey: 'BFakeVapidPublicKey_0123456789',
        subscriptions: [],
      },
    });
  });

  it('says so when push or email is not configured', async () => {
    const push = new FakePush();
    push.configured = false;
    push.publicKey = null;
    const email = new FakeEmail();
    email.configured = false;
    const app = buildApp(db, testEnv(), undefined, { push, email });
    const { cookie } = await createUserWithSession(db);
    const res = await api(app, cookie).get('/api/notifications');
    expect(res.body.email.available).toBe(false);
    expect(res.body.push).toMatchObject({ available: false, publicKey: null });
    const sub = await api(app, cookie).post(
      '/api/notifications/push-subscriptions',
      subscription(),
    );
    expect(sub.status).toBe(503);
  });

  it('saves preferences per user and rejects anything it does not know', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const res = await api(app, a.cookie).patch('/api/notifications', {
      emailEnabled: false,
      pushShowText: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.email.enabled).toBe(false);
    expect(res.body.push).toMatchObject({ enabled: true, showText: true });
    // Another user is untouched.
    expect((await api(app, b.cookie).get('/api/notifications')).body.email.enabled).toBe(true);
    // Partial updates keep the rest.
    await api(app, a.cookie).patch('/api/notifications', { pushEnabled: false });
    const again = await api(app, a.cookie).get('/api/notifications');
    expect(again.body.email.enabled).toBe(false);
    expect(again.body.push.enabled).toBe(false);

    for (const bad of [{}, { userId: b.user.id }, { emailEnabled: 'yes' }, { status: 'x' }]) {
      expect((await api(app, a.cookie).patch('/api/notifications', bad)).status).toBe(422);
    }
  });
});

describe('push subscription lifecycle', () => {
  it('subscribes, lists without exposing the endpoint, renews, and unsubscribes', async () => {
    const { app } = setup();
    const { cookie, user } = await createUserWithSession(db);
    const created = await api(app, cookie).post(
      '/api/notifications/push-subscriptions',
      subscription(1, { label: 'Chrome on Windows' }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const list = await api(app, cookie).get('/api/notifications');
    expect(list.body.push.subscriptions).toHaveLength(1);
    expect(list.body.push.subscriptions[0]).toMatchObject({ id, label: 'Chrome on Windows' });
    expect(JSON.stringify(list.body)).not.toContain('fcm.googleapis.com');
    expect(JSON.stringify(list.body)).not.toContain(P256DH);

    // The same browser subscribing again (key rotation / renewal) is one row, not two.
    const rotated = Buffer.alloc(65, 3).toString('base64url');
    const renewed = await api(app, cookie).post('/api/notifications/push-subscriptions', {
      endpoint: endpoint(1),
      keys: { p256dh: rotated, auth: AUTH },
      label: 'Chrome on Windows',
    });
    expect(renewed.body.id).toBe(id);
    const [row] = await db.select().from(pushSubscriptions);
    expect(row?.p256dh).toBe(rotated);

    expect((await api(app, cookie).del(`/api/notifications/push-subscriptions/${id}`)).status).toBe(
      204,
    );
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
    expect((await api(app, cookie).del(`/api/notifications/push-subscriptions/${id}`)).status).toBe(
      404,
    );
    expect(user.id).toBeDefined();
  });

  it('supports several devices and caps them at ten, dropping the oldest', async () => {
    const { app } = setup();
    const { cookie, user } = await createUserWithSession(db);
    for (let i = 1; i <= 12; i++) {
      const res = await api(app, cookie).post(
        '/api/notifications/push-subscriptions',
        subscription(i),
      );
      expect(res.status).toBe(201);
      // Distinct creation times so "oldest" is well defined.
      await db
        .update(pushSubscriptions)
        .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) })
        .where(eq(pushSubscriptions.id, res.body.id));
    }
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => r.endpoint === endpoint(1))).toBe(false);
  });

  it('one user cannot remove or see another user’s device', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const made = await api(app, a.cookie).post(
      '/api/notifications/push-subscriptions',
      subscription(1),
    );
    const del = await api(app, b.cookie).del(
      `/api/notifications/push-subscriptions/${made.body.id}`,
    );
    expect(del.status).toBe(404);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
    expect((await api(app, b.cookie).get('/api/notifications')).body.push.subscriptions).toEqual(
      [],
    );
  });

  it('a browser re-subscribed by another account moves to that account', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await api(app, a.cookie).post('/api/notifications/push-subscriptions', subscription(1));
    await api(app, b.cookie).post('/api/notifications/push-subscriptions', subscription(1));
    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(b.user.id);
  });

  it('rejects malformed, unsupported and server-side-request-forgery endpoints', async () => {
    const { app } = setup();
    const { cookie } = await createUserWithSession(db);
    const bad: object[] = [
      { ...subscription(1), endpoint: 'https://169.254.169.254/latest' },
      { ...subscription(1), endpoint: 'http://fcm.googleapis.com/x' },
      { ...subscription(1), endpoint: 'javascript:alert(1)' },
      { endpoint: endpoint(1), keys: { p256dh: 'short', auth: AUTH } },
      { endpoint: endpoint(1), keys: { p256dh: P256DH, auth: 'short' } },
      { endpoint: endpoint(1) },
      { ...subscription(1), userId: '00000000-0000-4000-8000-000000000000' },
    ];
    for (const body of bad) {
      const res = await api(app, cookie).post('/api/notifications/push-subscriptions', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it('an unknown or malformed id is "not found", never an error', async () => {
    const { app } = setup();
    const { cookie } = await createUserWithSession(db);
    for (const id of ['not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      expect(
        (await api(app, cookie).del(`/api/notifications/push-subscriptions/${id}`)).status,
      ).toBe(404);
    }
  });
});

describe('push delivery', () => {
  async function subscribed(n = 1) {
    const u = await createUserWithSession(db, { email: 'owner@example.com' });
    for (let i = 1; i <= n; i++) {
      await db.insert(pushSubscriptions).values({
        userId: u.user.id,
        endpoint: endpoint(i),
        p256dh: P256DH,
        auth: AUTH,
      });
    }
    return u;
  }

  it('pushes to every device once, with no reminder text by default', async () => {
    const { user } = await subscribed(2);
    await seedReminder(db, user.id);
    const push = new FakePush();
    const email = new FakeEmail();
    email.configured = false;
    const result = await tick(db, { push, email });
    expect(result).toMatchObject({ enqueued: 1, sent: 1 });
    expect(push.sent.map((s) => s.target.endpoint).sort()).toEqual([endpoint(1), endpoint(2)]);
    const { payload, options } = push.sent[0]!;
    expect(payload).toMatchObject({ title: 'NoteFlow', url: '/reminders' });
    expect(JSON.stringify(payload)).not.toContain('Send the invoice');
    expect(JSON.stringify(payload)).not.toContain('John');
    expect(JSON.stringify(payload)).not.toContain(NOTE_TITLE);
    expect(options.topic).toMatch(/^[0-9a-f]{32}$/);
    expect(options.ttlSeconds).toBeGreaterThan(0);
    const [row] = await db.select().from(notificationDeliveries);
    expect(row).toMatchObject({ channel: 'push', status: 'sent' });
  });

  it('includes the text only when the user opted in', async () => {
    const { user } = await subscribed();
    await db.insert(notificationPreferences).values({ userId: user.id, pushShowText: true });
    await seedReminder(db, user.id);
    const push = new FakePush();
    await tick(db, { push, email: new FakeEmail() });
    expect(push.sent[0]?.payload.body).toBe('Send the invoice');
  });

  it('does not send twice across ticks, restarts or concurrent workers', async () => {
    const { user } = await subscribed();
    await seedReminder(db, user.id);
    const push = new FakePush();
    await Promise.all([tick(db, { push }), tick(db, { push: new FakePush() })]);
    await tick(db, { push }, after(MINUTE));
    await tick(db, { push: new FakePush() }, after(2 * MINUTE));
    const rows = await db.select().from(notificationDeliveries);
    expect(rows.filter((r) => r.channel === 'push')).toHaveLength(1);
    expect(push.sent.length).toBeLessThanOrEqual(1);
  });

  it('removes an expired subscription and still delivers to the live one', async () => {
    const { user } = await subscribed(2);
    await seedReminder(db, user.id);
    const push = new FakePush();
    push.outcomes.set(endpoint(1), 'gone');
    await tick(db, { push, email: new FakeEmail() });
    const left = await db.select().from(pushSubscriptions);
    expect(left.map((l) => l.endpoint)).toEqual([endpoint(2)]);
    expect(push.sent).toHaveLength(1);
    expect(left[0]?.lastSuccessAt?.getTime()).toBe(FIXED_NOW.getTime());
  });

  it('removes every expired subscription, then records that nothing could be delivered', async () => {
    const { user } = await subscribed(1);
    await seedReminder(db, user.id);
    const push = new FakePush();
    push.fallback = 'gone';
    await tick(db, { push, email: new FakeEmail() });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
    const [row] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.channel, 'push'));
    expect(row?.status).toBe('failed');
  });

  it('retries when the push service is temporarily unavailable', async () => {
    const { user } = await subscribed();
    await seedReminder(db, user.id);
    const push = new FakePush();
    push.fallback = 'unavailable';
    const email = new FakeEmail();
    email.configured = false;
    expect(await tick(db, { push, email })).toMatchObject({ retried: 1 });
    push.fallback = 'sent';
    await tick(db, { push, email }, after(MINUTE));
    expect(push.sent).toHaveLength(1);
    expect((await db.select().from(notificationDeliveries))[0]).toMatchObject({
      status: 'sent',
      attempts: 2,
    });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1); // a hiccup deletes nothing
  });

  it('sends nothing when the user has no device, or has paused push', async () => {
    const quiet = await createUserWithSession(db, { email: 'quiet@example.com' });
    await seedReminder(db, quiet.user.id);
    const paused = await subscribed();
    await db.insert(notificationPreferences).values({ userId: paused.user.id, pushEnabled: false });
    await seedReminder(db, paused.user.id);
    const push = new FakePush();
    const email = new FakeEmail();
    email.configured = false;
    await tick(db, { push, email });
    expect(push.attempts).toBe(0);
    expect(await db.select().from(notificationDeliveries)).toHaveLength(0);
  });

  it('notifies an eligible shared recipient, labelled as shared, and respects their settings', async () => {
    const owner = await subscribed();
    const friend = await createUserWithSession(db, { email: 'friend@example.com' });
    const stranger = await createUserWithSession(db, { email: 'stranger@example.com' });
    for (const u of [friend, stranger]) {
      await db.insert(pushSubscriptions).values({
        userId: u.user.id,
        endpoint: endpoint(u.user.email),
        p256dh: P256DH,
        auth: AUTH,
      });
    }
    const { reminder } = await seedReminder(db, owner.user.id);
    await db.insert(reminderShares).values({
      reminderId: reminder.id,
      ownerId: owner.user.id,
      recipientId: friend.user.id,
      createdAt: new Date(DUE_AT.getTime() - 3_600_000),
    });
    const push = new FakePush();
    await tick(db, { push, email: new FakeEmail() });
    const endpoints = push.sent.map((s) => s.target.endpoint).sort();
    expect(endpoints).toEqual([endpoint(1), endpoint('friend@example.com')].sort());
    const toFriend = push.sent.find((s) => s.target.endpoint === endpoint('friend@example.com'));
    expect(toFriend?.payload.body).toBe('A reminder was shared with you and is due.');
    expect(JSON.stringify(toFriend?.payload)).not.toContain(NOTE_TITLE);
    // Someone it was never shared with gets nothing.
    expect(endpoints).not.toContain(endpoint('stranger@example.com'));
  });
});
