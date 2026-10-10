import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sessions } from '../../src/db/schema.js';
import { createSession } from '../../src/auth/sessions.js';
import {
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const sessionCookie = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) =>
    c.startsWith('noteflow_session='),
  );

async function signIn(query: string, callbackQuery = '', env = testEnv()) {
  const google = new FakeGoogle();
  const app = buildApp(db, env, google);
  const agent = request.agent(app);
  const start = await agent.get(`/api/auth/google${query}`);
  const state = new URL(start.headers.location ?? '').searchParams.get('state') ?? '';
  const callback = await agent.get(
    `/api/auth/google/callback?code=abc&state=${state}${callbackQuery}`,
  );
  return { agent, app, start, callback };
}

async function onlySession() {
  const rows = await db.select().from(sessions);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('Remember me', () => {
  it('without it: a browser-session cookie, and the server session is short', async () => {
    const { callback } = await signIn('');
    const cookie = sessionCookie(callback) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Expires=|Max-Age=/i);
    const left = (await onlySession()).expiresAt.getTime() - Date.now();
    expect(left).toBeGreaterThan(23 * HOUR);
    expect(left).toBeLessThanOrEqual(24 * HOUR);
  });

  it('with it: a dated cookie of about 30 days that matches the server session', async () => {
    const { callback } = await signIn('?remember=1');
    const cookie = sessionCookie(callback) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const expires = new Date(/Expires=([^;]+)/i.exec(cookie)?.[1] ?? '').getTime();
    const stored = (await onlySession()).expiresAt.getTime();
    expect(Math.abs(expires - stored)).toBeLessThan(2_000); // cookie dates have 1 s resolution
    expect(stored - Date.now()).toBeGreaterThan(29 * DAY);
    expect(stored - Date.now()).toBeLessThanOrEqual(30 * DAY);
  });

  it('honours REMEMBER_ME_TTL_DAYS', async () => {
    await signIn('?remember=1', '', testEnv({ REMEMBER_ME_TTL_DAYS: '7' }));
    const left = (await onlySession()).expiresAt.getTime() - Date.now();
    expect(left).toBeGreaterThan(6 * DAY);
    expect(left).toBeLessThanOrEqual(7 * DAY);
  });

  it('both cookies are Secure in production', async () => {
    // A Secure cookie is not replayed over http by the test client, so carry it by hand.
    const app = buildApp(db, testEnv({ NODE_ENV: 'production' }), new FakeGoogle());
    const start = await request(app).get('/api/auth/google?remember=1');
    const oauthCookie = (start.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(oauthCookie).toMatch(/Secure/i);
    const state = new URL(start.headers.location ?? '').searchParams.get('state') ?? '';
    const callback = await request(app)
      .get(`/api/auth/google/callback?code=abc&state=${state}`)
      .set('Cookie', oauthCookie.split(';')[0] ?? '');
    expect(sessionCookie(callback)).toMatch(/Secure/i);
    expect(sessionCookie(callback)).toMatch(/Expires=/i);
  });

  it('only the exact value 1 counts as a request to be remembered', async () => {
    for (const value of ['0', 'true', 'yes', '']) {
      await resetDb(db);
      const { callback } = await signIn(`?remember=${value}`);
      expect(sessionCookie(callback)).not.toMatch(/Expires=/i);
    }
  });

  it('a remember parameter on the callback is ignored: the choice is fixed at sign-in start', async () => {
    const { callback } = await signIn('', '&remember=1');
    expect(sessionCookie(callback)).not.toMatch(/Expires=/i);
    expect((await onlySession()).expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * HOUR);
  });

  it('an oauth cookie that claims remember without a valid signature is rejected', async () => {
    const google = new FakeGoogle();
    const app = buildApp(db, testEnv(), google);
    const payload = { state: 'x', codeVerifier: 'y', nonce: 'z', remember: true };
    const forged = `noteflow_oauth=${encodeURIComponent(
      's:' + JSON.stringify(payload) + '.not-the-signature',
    )}`;
    const res = await request(app)
      .get('/api/auth/google/callback?code=a&state=x')
      .set('Cookie', forged);
    expect(new URL(res.headers.location ?? '').searchParams.get('error')).toBe('invalid_state');
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(google.completed).toHaveLength(0);
  });

  it('the cookie authenticates, and the same token is refused once it has expired', async () => {
    const { agent } = await signIn('?remember=1');
    expect((await agent.get('/api/me')).status).toBe(200);
    const row = await onlySession();
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, row.id));
    expect((await agent.get('/api/me')).status).toBe(401);
  });

  it('a session past its stored expiry is refused when the cookie is replayed', async () => {
    const { user } = await createUserWithSession(db);
    const old = new Date(Date.now() - 40 * DAY);
    const { token } = await createSession(db, user.id, 30, old); // expired 10 days ago
    const res = await request(buildApp(db))
      .get('/api/me')
      .set('Cookie', `noteflow_session=${token}`);
    expect(res.status).toBe(401);
  });

  it('logout revokes the server session, so a copied cookie stops working', async () => {
    const { callback, agent } = await signIn('?remember=1');
    const token = /noteflow_session=([^;]+)/.exec(sessionCookie(callback) ?? '')?.[1];
    expect(token).toBeDefined();
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect(await db.select().from(sessions)).toHaveLength(0);
    const replay = await request(buildApp(db))
      .get('/api/me')
      .set('Cookie', `noteflow_session=${token}`);
    expect(replay.status).toBe(401);
  });

  it('a fresh sign-in replaces the previous session instead of stacking them', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));
    for (const query of ['?remember=1', '']) {
      const start = await agent.get(`/api/auth/google${query}`);
      const state = new URL(start.headers.location ?? '').searchParams.get('state') ?? '';
      await agent.get(`/api/auth/google/callback?code=a&state=${state}`);
    }
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('protected routes still need a session when signed out', async () => {
    expect((await request(buildApp(db)).get('/api/notes')).status).toBe(401);
  });
});
