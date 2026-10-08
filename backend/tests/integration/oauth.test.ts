import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sessions, users } from '../../src/db/schema.js';
import {
  FakeGoogle,
  buildApp,
  openTestDb,
  resetDb,
  testEnv,
  type TestDb,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const FRONTEND = 'http://localhost:5173';
const loginError = (res: request.Response) =>
  new URL(res.headers.location ?? '', FRONTEND).searchParams.get('error');

async function counts(d: TestDb) {
  return {
    users: (await d.select().from(users)).length,
    sessions: (await d.select().from(sessions)).length,
  };
}

/** Runs step 1 on a cookie-keeping agent and returns the state Google would echo back. */
async function startLogin(agent: ReturnType<typeof request.agent>, query = '') {
  const res = await agent.get(`/api/auth/google${query}`);
  expect(res.status).toBe(302);
  const target = new URL(res.headers.location ?? '');
  return { res, state: target.searchParams.get('state') ?? '' };
}

describe('GET /api/auth/google (start)', () => {
  it('redirects to the provider and sets a signed, httpOnly, Lax, path-scoped cookie', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));
    const { res, state } = await startLogin(agent);
    expect(state).toBe(google.started[0]?.state);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/noteflow_oauth=s%3A/); // signed value
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).not.toMatch(/Secure/i); // NODE_ENV=test
  });

  it('marks the cookie Secure in production', async () => {
    const env = testEnv({ NODE_ENV: 'production' });
    const res = await request(buildApp(db, env, new FakeGoogle())).get('/api/auth/google');
    expect(String(res.headers['set-cookie'])).toMatch(/Secure/i);
  });

  it('reports missing Google configuration as a controlled error, not a crash or bypass', async () => {
    const env = testEnv({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_REDIRECT_URI: undefined,
    });
    const res = await request(buildApp(db, env)).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(loginError(res)).toBe('not_configured');
    expect(res.headers['set-cookie']).toBeDefined(); // only the cleared oauth cookie
    expect(String(res.headers['set-cookie'])).not.toMatch(/noteflow_session=[^;]+/);
  });
});

describe('GET /api/auth/google/callback', () => {
  it('creates a user and a hashed server-side session, sets the session cookie, redirects home', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));
    const { state } = await startLogin(agent);

    const res = await agent.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${FRONTEND}/`);

    const setCookie = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(setCookie).toMatch(/noteflow_session=[A-Za-z0-9_-]{40,}/);
    expect(setCookie).toMatch(/noteflow_session=[^\n]*HttpOnly/i);
    expect(setCookie).toMatch(/noteflow_session=[^\n]*SameSite=Lax/i);
    expect(setCookie).toMatch(/noteflow_session=[^\n]*Expires=/i);

    // PKCE verifier and nonce from the start step reach the token exchange; state matches.
    expect(google.completed).toHaveLength(1);
    expect(google.completed[0]?.checks).toEqual(google.started[0]);
    expect(google.completed[0]?.url.searchParams.get('code')).toBe('abc');
    const cbUrl = google.completed[0]?.url;
    expect(`${cbUrl?.origin}${cbUrl?.pathname}`).toBe(
      'http://localhost:5173/api/auth/google/callback',
    );

    expect(await counts(db)).toEqual({ users: 1, sessions: 1 });
    // The new cookie really authenticates.
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('person@example.com');
  });

  it('uses the browser timezone for new users only, ignoring invalid ones', async () => {
    const google = new FakeGoogle();
    const app = buildApp(db, testEnv(), google);

    const a1 = request.agent(app);
    const s1 = await startLogin(a1, '?tz=Asia/Kolkata');
    await a1.get(`/api/auth/google/callback?code=c&state=${s1.state}`);
    expect((await a1.get('/api/me')).body.user.timezone).toBe('Asia/Kolkata');

    // Logging in again with another tz must not overwrite the stored value.
    const a2 = request.agent(app);
    const s2 = await startLogin(a2, '?tz=Europe/Paris');
    await a2.get(`/api/auth/google/callback?code=c&state=${s2.state}`);
    expect((await a2.get('/api/me')).body.user.timezone).toBe('Asia/Kolkata');
    expect((await db.select().from(users)).length).toBe(1); // upsert by google_sub

    google.identity = { ...google.identity, sub: 'other-sub', email: 'other@example.com' };
    const a3 = request.agent(app);
    const s3 = await startLogin(a3, '?tz=Not/AZone');
    await a3.get(`/api/auth/google/callback?code=c&state=${s3.state}`);
    expect((await a3.get('/api/me')).body.user.timezone).toBe('UTC');
  });

  it('rejects a wrong state without creating a user or session, or calling Google', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));
    await startLogin(agent);
    const res = await agent.get('/api/auth/google/callback?code=abc&state=attacker-state');
    expect(res.status).toBe(302);
    expect(loginError(res)).toBe('invalid_state');
    expect(google.completed).toHaveLength(0);
    expect(await counts(db)).toEqual({ users: 0, sessions: 0 });
    expect(String(res.headers['set-cookie'])).not.toMatch(/noteflow_session=[^;]+/);
  });

  it('rejects a callback with no state parameter', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));
    await startLogin(agent);
    const res = await agent.get('/api/auth/google/callback?code=abc');
    expect(loginError(res)).toBe('invalid_state');
    expect(await counts(db)).toEqual({ users: 0, sessions: 0 });
  });

  it('rejects a callback that arrives without the oauth cookie (e.g. forged link)', async () => {
    const google = new FakeGoogle();
    const res = await request(buildApp(db, testEnv(), google)).get(
      '/api/auth/google/callback?code=abc&state=whatever',
    );
    expect(loginError(res)).toBe('invalid_state');
    expect(google.completed).toHaveLength(0);
    expect(await counts(db)).toEqual({ users: 0, sessions: 0 });
  });

  it('rejects a tampered oauth cookie', async () => {
    const google = new FakeGoogle();
    const app = buildApp(db, testEnv(), google);
    const start = await request(app).get('/api/auth/google');
    const forged = `noteflow_oauth=${encodeURIComponent(
      's:' + JSON.stringify({ state: 'x', codeVerifier: 'y', nonce: 'z' }) + '.badsignature',
    )}`;
    expect(String(start.headers['set-cookie'])).toContain('noteflow_oauth=');
    const res = await request(app)
      .get('/api/auth/google/callback?code=abc&state=x')
      .set('Cookie', forged);
    expect(loginError(res)).toBe('invalid_state');
    expect(google.completed).toHaveLength(0);
  });

  it('rejects replay: the oauth cookie is cleared after a callback', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));
    const { state } = await startLogin(agent);
    await agent.get(`/api/auth/google/callback?code=abc&state=${state}`);
    const replay = await agent.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(loginError(replay)).toBe('invalid_state');
    expect(google.completed).toHaveLength(1);
  });

  it('handles the user denying consent', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));
    await startLogin(agent);
    const res = await agent.get('/api/auth/google/callback?error=access_denied');
    expect(loginError(res)).toBe('access_denied');
    expect(await counts(db)).toEqual({ users: 0, sessions: 0 });
  });

  it('does not create a session when token/ID-token verification fails (and leaks nothing)', async () => {
    const google = new FakeGoogle();
    google.failWith = new Error('nonce mismatch: secret-detail-123');
    const agent = request.agent(buildApp(db, testEnv(), google));
    const { state } = await startLogin(agent);
    const res = await agent.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(loginError(res)).toBe('login_failed');
    expect(res.headers.location).not.toContain('secret-detail');
    expect(await counts(db)).toEqual({ users: 0, sessions: 0 });
  });

  it('refuses unverified Google emails', async () => {
    const google = new FakeGoogle();
    google.identity = { ...google.identity, emailVerified: false };
    const agent = request.agent(buildApp(db, testEnv(), google));
    const { state } = await startLogin(agent);
    const res = await agent.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(loginError(res)).toBe('email_unverified');
    expect(await counts(db)).toEqual({ users: 0, sessions: 0 });
  });

  it('reports missing Google configuration on callback without creating anything', async () => {
    const env = testEnv({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_REDIRECT_URI: undefined,
    });
    const res = await request(buildApp(db, env)).get('/api/auth/google/callback?code=a&state=b');
    expect(res.status).toBe(302);
    expect(['not_configured', 'invalid_state']).toContain(loginError(res));
    expect(await counts(db)).toEqual({ users: 0, sessions: 0 });
  });
});
