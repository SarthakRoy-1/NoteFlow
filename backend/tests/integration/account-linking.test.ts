import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/auth/sessions.js';
import { oauthLinkAttempts, sessions, users } from '../../src/db/schema.js';
import { createRateLimiter } from '../../src/lib/rateLimit.js';
import {
  FakeEmail,
  FakeGoogle,
  PASSWORD,
  buildApp,
  createPasswordUserWithSession,
  createUserWithSession,
  generousAuthLimiters,
  openTestDb,
  resetDb,
  testEnv,
  PASSWORD_AUTH_ON,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
let google: FakeGoogle;
let clock: { now: () => Date; advance: (ms: number) => void };
let app: ReturnType<typeof buildApp>;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  google = new FakeGoogle();
  google.identity = {
    sub: 'g-pat',
    email: 'pat.gmail@example.com',
    emailVerified: true,
    name: 'Pat G',
  };
  let t = new Date('2026-10-08T10:00:00Z').getTime();
  clock = { now: () => new Date(t), advance: (ms) => (t += ms) };
  app = buildApp(db, testEnv(PASSWORD_AUTH_ON), google, { email: new FakeEmail(), now: clock.now });
});

const startLink = (cookie: string, password = PASSWORD, target = app) =>
  request(target).post('/api/auth/link/google/start').set('Cookie', cookie).send({ password });
const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';
const callback = (state: string, cookie?: string, extra = '') => {
  const r = request(app).get(`/api/auth/google/callback?code=c&state=${state}${extra}`);
  return cookie ? r.set('Cookie', cookie) : r;
};
const landing = (res: { headers: Record<string, unknown> }) => String(res.headers.location ?? '');

async function owner(opts: { email?: string } = {}) {
  return createPasswordUserWithSession(db, { email: opts.email ?? 'pat@example.com' });
}

describe('starting a link', () => {
  it('needs a signed-in session', async () => {
    const res = await request(app).post('/api/auth/link/google/start').send({ password: PASSWORD });
    expect(res.status).toBe(401);
    expect(google.started).toHaveLength(0);
  });

  it('needs the account password again (recent re-authentication)', async () => {
    const pat = await owner();
    const res = await startLink(pat.cookie, 'a wrong password');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REAUTH_FAILED');
    expect(google.started).toHaveLength(0);
    expect(await db.select().from(oauthLinkAttempts)).toHaveLength(0);
  });

  it('validates the body', async () => {
    const pat = await owner();
    const res = await request(app)
      .post('/api/auth/link/google/start')
      .set('Cookie', pat.cookie)
      .send({});
    expect(res.status).toBe(422);
  });

  it('refuses an account that already has Google', async () => {
    const g = await createUserWithSession(db, { email: 'g@example.com' });
    const res = await startLink(g.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_LINKED');
  });

  it('stores only a hash of the one-time state, bound to the account and this session', async () => {
    const pat = await owner();
    const res = await startLink(pat.cookie);
    expect(res.status).toBe(200);
    const state = stateOf(res.body.url);
    const [attempt] = await db.select().from(oauthLinkAttempts);
    expect(attempt?.stateHash).toBe(hashToken(state));
    expect(attempt?.stateHash).not.toBe(state);
    expect(attempt?.userId).toBe(pat.user.id);
    expect(attempt?.sessionId).toBe(hashToken(pat.token));
    expect(attempt?.expiresAt.getTime()).toBe(clock.now().getTime() + 10 * 60 * 1000);
  });

  it('is rate limited per account', async () => {
    const pat = await owner();
    const limited = buildApp(db, testEnv(PASSWORD_AUTH_ON), google, {
      email: new FakeEmail(),
      now: clock.now,
      authLimiters: {
        ...generousAuthLimiters(),
        link: createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now }),
      },
    });
    await startLink(pat.cookie, 'wrong password 1', limited);
    await startLink(pat.cookie, 'wrong password 2', limited);
    expect((await startLink(pat.cookie, PASSWORD, limited)).status).toBe(429);
  });

  it('blocks a cross-origin start', async () => {
    const pat = await owner();
    const res = await startLink(pat.cookie).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});

describe('completing a link', () => {
  it('attaches Google to the account that started it, and Google sign-in then reaches that account', async () => {
    const pat = await owner();
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state, pat.cookie);

    expect(res.status).toBe(302);
    expect(landing(res)).toBe('http://localhost:5173/settings?link=ok');
    const [user] = await db.select().from(users).where(eq(users.id, pat.user.id));
    expect(user?.googleSub).toBe('g-pat');
    expect(user?.email).toBe('pat@example.com'); // the account email is not rewritten
    expect(user?.passwordHash).toBeTruthy(); // password still works
    expect(await db.select().from(users)).toHaveLength(1);

    // Plain Google sign-in now lands in the same account.
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    const loginState = new URL(String(start.headers.location)).searchParams.get('state');
    await agent.get(`/api/auth/google/callback?code=c&state=${loginState}`);
    expect((await agent.get('/api/me')).body.user.id).toBe(pat.user.id);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('refuses a replayed callback', async () => {
    const pat = await owner();
    const state = stateOf((await startLink(pat.cookie)).body.url);
    await callback(state, pat.cookie);
    google.identity = { ...google.identity, sub: 'g-other' };
    const replay = await callback(state, pat.cookie);
    expect(landing(replay)).toContain('link=link_invalid');
    const [user] = await db.select().from(users);
    expect(user?.googleSub).toBe('g-pat');
  });

  it('refuses an expired attempt', async () => {
    const pat = await owner();
    const state = stateOf((await startLink(pat.cookie)).body.url);
    clock.advance(10 * 60 * 1000 + 1000);
    const res = await callback(state, pat.cookie);
    expect(landing(res)).toContain('link=link_expired');
    expect((await db.select().from(users))[0]?.googleSub).toBeNull();
  });

  it('treats an unknown or mismatched state as an ordinary (failed) sign-in, linking nothing', async () => {
    const pat = await owner();
    await startLink(pat.cookie);
    const res = await callback('state-nobody-issued', pat.cookie);
    expect(landing(res)).toContain('/login?error=invalid_state');
    expect((await db.select().from(users))[0]?.googleSub).toBeNull();
    expect(google.completed).toHaveLength(0);
  });

  it('refuses a callback from another session of the same account', async () => {
    const pat = await owner();
    const otherSession = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pat@example.com', password: PASSWORD });
    const otherCookie = String(otherSession.headers['set-cookie']?.[0]).split(';')[0] ?? '';
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state, otherCookie);
    expect(landing(res)).toContain('link=link_session_mismatch');
    expect((await db.select().from(users))[0]?.googleSub).toBeNull();
    expect(google.completed).toHaveLength(0);
  });

  it('refuses a callback that arrives in a different user’s session (cross-account)', async () => {
    const pat = await owner();
    const mallory = await createPasswordUserWithSession(db, { email: 'mallory@example.com' });
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state, mallory.cookie);
    expect(landing(res)).toContain('link=link_session_mismatch');
    const rows = await db.select().from(users);
    expect(rows.every((u) => u.googleSub === null)).toBe(true);
  });

  it('refuses a callback with no session at all (a forged link opened by someone else)', async () => {
    const pat = await owner();
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state);
    expect(landing(res)).toContain('link=link_session_mismatch');
    expect((await db.select().from(users))[0]?.googleSub).toBeNull();
  });

  it('refuses when the Google identity already belongs to another account', async () => {
    const pat = await owner();
    await createUserWithSession(db, { email: 'someone@example.com', sub: 'g-pat' });
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state, pat.cookie);
    expect(landing(res)).toContain('link=link_identity_taken');
    const [patRow] = await db.select().from(users).where(eq(users.id, pat.user.id));
    expect(patRow?.googleSub).toBeNull();
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('requires a verified Google email', async () => {
    const pat = await owner();
    google.identity = { ...google.identity, emailVerified: false };
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state, pat.cookie);
    expect(landing(res)).toContain('link=link_email_unverified');
    expect((await db.select().from(users))[0]?.googleSub).toBeNull();
  });

  it('reports a provider failure without linking or leaking details', async () => {
    const pat = await owner();
    google.failWith = new Error('invalid_grant secret-detail');
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state, pat.cookie);
    expect(landing(res)).toContain('link=link_failed');
    expect(landing(res)).not.toContain('secret-detail');
  });

  it('handles the user cancelling at Google', async () => {
    const pat = await owner();
    const state = stateOf((await startLink(pat.cookie)).body.url);
    const res = await callback(state, pat.cookie, '&error=access_denied');
    expect(landing(res)).toContain('link=link_cancelled');
    expect(google.completed).toHaveLength(0);
  });

  it('ends the attempt when its session ends', async () => {
    const pat = await owner();
    const state = stateOf((await startLink(pat.cookie)).body.url);
    await db.delete(sessions).where(eq(sessions.id, hashToken(pat.token)));
    expect(await db.select().from(oauthLinkAttempts)).toHaveLength(0);
    const res = await callback(state, pat.cookie);
    expect(landing(res)).toContain('/login?error=invalid_state');
  });
});

describe('no silent merging', () => {
  it('a Google sign-in never attaches to a password account just because the email matches', async () => {
    await owner({ email: 'person@example.com' });
    google.identity = {
      sub: 'g-person',
      email: 'person@example.com',
      emailVerified: true,
      name: 'P',
    };
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const res = await agent.get(`/api/auth/google/callback?code=c&state=${state}`);
    expect(landing(res)).toContain('error=email_in_use');
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.googleSub).toBeNull();
  });

  it('Google-only sign-in keeps working', async () => {
    google.identity = { sub: 'g-new', email: 'new@example.com', emailVerified: true, name: 'N' };
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    await agent.get(`/api/auth/google/callback?code=c&state=${state}`);
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.signIn).toEqual({ password: false, google: true });
  });
});
