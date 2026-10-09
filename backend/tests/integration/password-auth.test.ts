import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/auth/sessions.js';
import { notes, pendingRegistrations, sessions, users } from '../../src/db/schema.js';
import { EmailDeliveryError } from '../../src/email/types.js';
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
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
let email: FakeEmail;
let app: ReturnType<typeof buildApp>;
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  email = new FakeEmail();
  app = buildApp(db, testEnv(), undefined, { email });
});

type Agent = ReturnType<typeof request.agent>;
const signUp = (
  target: Agent | ReturnType<typeof buildApp>,
  body: Record<string, unknown> = {},
) => {
  const t = typeof target === 'function' ? request(target) : target;
  return (t as Agent)
    .post('/api/auth/register')
    .send({ name: 'Pat Person', email: 'pat@example.com', password: PASSWORD, ...body });
};
const login = (agent: Agent, body: Record<string, unknown> = {}) =>
  agent.post('/api/auth/login').send({ email: 'pat@example.com', password: PASSWORD, ...body });
const tokenFrom = (res: { headers: Record<string, unknown> }) =>
  /noteflow_session=([^;]+)/.exec(
    String((res.headers['set-cookie'] as string[] | undefined)?.[0] ?? ''),
  )?.[1] ?? '';

describe('POST /api/auth/register', () => {
  it('creates only a pending sign-up: no account, no session, one verification email', async () => {
    const res = await signUp(app);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(pendingRegistrations)).toHaveLength(1);

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe('pat@example.com');
    expect(email.sent[0]?.text).toMatch(/http:\/\/localhost:5173\/verify-email#token=/);
  });

  it('stores the token only as a hash, and the password only as Argon2id', async () => {
    await signUp(app);
    const token = email.lastToken('pat@example.com');
    const [row] = await db.select().from(pendingRegistrations);
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('normalises the email and falls back to UTC for a bad timezone', async () => {
    await signUp(app, { email: ' Pat@Example.COM ', name: ' Pat ', timezone: 'Not/AZone' });
    const [row] = await db.select().from(pendingRegistrations);
    expect(row).toMatchObject({ email: 'pat@example.com', name: 'Pat', timezone: 'UTC' });
  });

  it('answers identically for a new address and one that already has an account', async () => {
    await createPasswordUserWithSession(db, { email: 'taken@example.com' });
    const fresh = await signUp(app, { email: 'fresh@example.com' });
    const taken = await signUp(app, { email: 'taken@example.com' });
    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toEqual(fresh.body);
    expect(taken.headers['set-cookie']).toBeUndefined();
    // The existing owner is told, by email, that an account exists; no pending row is made for it.
    expect(email.to('taken@example.com')[0]?.subject).toMatch(/already have/i);
    expect(email.to('taken@example.com')[0]?.text).not.toMatch(/#token=/);
    expect(await db.select().from(pendingRegistrations)).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('is also generic for an address that belongs to a Google account', async () => {
    await createUserWithSession(db, { email: 'pat@example.com' });
    const res = await signUp(app);
    expect(res.status).toBe(202);
    expect(await db.select().from(pendingRegistrations)).toHaveLength(0);
  });

  it('the latest sign-up for an address replaces the earlier pending one', async () => {
    await signUp(app);
    const first = email.lastToken('pat@example.com');
    await signUp(app, { password: 'a different long password' });
    expect(await db.select().from(pendingRegistrations)).toHaveLength(1);
    const second = email.lastToken('pat@example.com');
    expect(second).not.toBe(first);
    const stale = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: first, password: PASSWORD });
    expect(stale.status).toBe(400);
  });

  it('reports a server without email honestly instead of pretending', async () => {
    email.configured = false;
    const res = await signUp(app);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EMAIL_NOT_CONFIGURED');
    expect(email.sent).toHaveLength(0);
    expect(await db.select().from(pendingRegistrations)).toHaveLength(0);
  });

  it('GET /api/auth/config tells the UI whether email works', async () => {
    expect((await request(app).get('/api/auth/config')).body).toEqual({ emailEnabled: true });
    email.configured = false;
    expect((await request(app).get('/api/auth/config')).body).toEqual({ emailEnabled: false });
  });

  it('a provider failure does not change the response or leak anything', async () => {
    email.failWith = new EmailDeliveryError('unavailable');
    const res = await signUp(app);
    expect(res.status).toBe(202);
    expect(JSON.stringify(res.body)).not.toMatch(/unavailable|provider/i);
  });

  it.each([
    ['empty body', { name: undefined, email: undefined, password: undefined }],
    ['missing name', { name: undefined }],
    ['blank name', { name: '   ' }],
    ['missing email', { email: undefined }],
    ['malformed email', { email: 'not-an-email' }],
    ['email without domain', { email: 'pat@' }],
    ['too-long email', { email: `${'a'.repeat(250)}@x.com` }],
    ['missing password', { password: undefined }],
    ['short password', { password: 'short' }],
    ['too-long password', { password: 'x'.repeat(129) }],
    ['non-string password', { password: 12345678901234 }],
  ])('rejects %s with a 422 and stores nothing', async (_label, patch) => {
    const res = await signUp(app, patch);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await db.select().from(pendingRegistrations)).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
  });

  it('rejects malformed JSON and cross-origin requests', async () => {
    const bad = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(bad.status).toBe(400);
    const foreign = await signUp(app).set('Origin', 'https://evil.example');
    expect(foreign.status).toBe(403);
    expect(await db.select().from(pendingRegistrations)).toHaveLength(0);
  });

  it('ignores client-supplied ids, hashes and verification flags', async () => {
    await signUp(app, {
      id: 'x',
      passwordHash: 'z',
      emailVerifiedAt: '2020-01-01',
      googleSub: 's',
    });
    const [row] = await db.select().from(pendingRegistrations);
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await db.select().from(users)).toHaveLength(0);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await createPasswordUserWithSession(db);
    await db.delete(sessions);
  });

  it('signs in with the right password (email is case- and space-insensitive)', async () => {
    const agent = request.agent(app);
    const res = await login(agent, { email: '  PAT@Example.com ' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'pat@example.com',
      signIn: { password: true, google: false },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/i);
    const cookie = String(res.headers['set-cookie']?.[0]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('marks the session cookie Secure in production', async () => {
    const prod = buildApp(db, testEnv({ NODE_ENV: 'production' }), undefined, { email });
    const res = await login(request.agent(prod));
    expect(String(res.headers['set-cookie']?.[0])).toMatch(/Secure/i);
  });

  it('stores only a hash of the session token', async () => {
    const token = tokenFrom(await login(request.agent(app)));
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(hashToken(token));
  });

  it('uses the same error for a wrong password, an unknown email and a Google-only account', async () => {
    await createUserWithSession(db, { email: 'google-only@example.com' });
    const wrong = await login(request.agent(app), { password: 'the wrong password' });
    const unknown = await login(request.agent(app), { email: 'nobody@example.com' });
    const googleOnly = await login(request.agent(app), { email: 'google-only@example.com' });
    for (const res of [wrong, unknown, googleOnly]) {
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(unknown.body).toEqual(wrong.body);
    expect(googleOnly.body).toEqual(wrong.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('a pending (unverified) sign-up cannot sign in', async () => {
    await signUp(app, { email: 'new@example.com' });
    const res = await login(request.agent(app), { email: 'new@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('an account from before verification existed is told to verify, but only after the right password', async () => {
    await createPasswordUserWithSession(db, { email: 'old@example.com', verified: false });
    const right = await login(request.agent(app), { email: 'old@example.com' });
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(right.headers['set-cookie']).toBeUndefined();
    const wrong = await login(request.agent(app), {
      email: 'old@example.com',
      password: 'nope nope nope',
    });
    expect(wrong.status).toBe(401);
  });

  it.each([
    ['empty body', { email: undefined, password: undefined }],
    ['missing password', { password: undefined }],
    ['empty password', { password: '' }],
    ['malformed email', { email: 'nope' }],
    ['missing email', { email: undefined }],
  ])('rejects %s with 422', async (_label, patch) => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pat@example.com', password: PASSWORD, ...patch });
    expect(res.status).toBe(422);
  });

  it('issues a new session token and revokes the one the browser held (no fixation)', async () => {
    const agent = request.agent(app);
    const oldToken = tokenFrom(await login(agent));
    const newToken = tokenFrom(await login(agent));
    expect(newToken).not.toBe(oldToken);
    const stale = await request(app).get('/api/me').set('Cookie', `noteflow_session=${oldToken}`);
    expect(stale.status).toBe(401);
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('ignores a session token chosen by the attacker', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', 'noteflow_session=attacker-chosen-token')
      .send({ email: 'pat@example.com', password: PASSWORD });
    const token = tokenFrom(res);
    expect(token).not.toBe('');
    expect(token).not.toBe('attacker-chosen-token');
  });

  it('logout invalidates the session server-side, and the old cookie stops working', async () => {
    const agent = request.agent(app);
    const token = tokenFrom(await login(agent));
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect(
      await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, hashToken(token))),
    ).toHaveLength(0);
    const replay = await request(app).get('/api/me').set('Cookie', `noteflow_session=${token}`);
    expect(replay.status).toBe(401);
  });

  it('an expired session is rejected', async () => {
    const token = tokenFrom(await login(request.agent(app)));
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, hashToken(token)));
    const res = await request(app).get('/api/me').set('Cookie', `noteflow_session=${token}`);
    expect(res.status).toBe(401);
  });

  it('a corrupt stored hash gives the generic error, not a crash', async () => {
    await db.update(users).set({ passwordHash: 'garbage' });
    expect((await login(request.agent(app))).status).toBe(401);
  });

  it('blocks a cross-origin login', async () => {
    const res = await login(request.agent(app)).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});

describe('data isolation between password accounts', () => {
  it('one user cannot read or change another user’s notes', async () => {
    const a = await createPasswordUserWithSession(db, { email: 'a@example.com' });
    const b = await createPasswordUserWithSession(db, { email: 'b@example.com' });
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', a.cookie)
      .send({ title: 'Mine', content: 'private' });
    const id = created.body.note.id as string;

    expect((await request(app).get(`/api/notes/${id}`).set('Cookie', b.cookie)).status).toBe(404);
    expect((await request(app).get('/api/notes').set('Cookie', b.cookie)).body.notes).toEqual([]);
    expect((await request(app).delete(`/api/notes/${id}`).set('Cookie', b.cookie)).status).toBe(
      404,
    );
    expect(await db.select().from(notes)).toHaveLength(1);
  });

  it('protected routes reject callers without a session', async () => {
    for (const path of [
      '/api/me',
      '/api/notes',
      '/api/todos',
      '/api/reminders',
      '/api/ask/history',
    ]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });
});

describe('Google OAuth and password accounts together', () => {
  const startAndFinish = async (google: FakeGoogle) => {
    const agent = request.agent(buildApp(db, testEnv(), google, { email }));
    const start = await agent.get('/api/auth/google');
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const res = await agent.get(`/api/auth/google/callback?code=c&state=${state}`);
    return { agent, res };
  };

  it('Google sign-in still works for a brand-new Google user, and marks the email verified', async () => {
    const { agent, res } = await startAndFinish(new FakeGoogle());
    expect(res.status).toBe(302);
    expect((await agent.get('/api/me')).status).toBe(200);
    expect((await db.select().from(users))[0]?.emailVerifiedAt).not.toBeNull();
  });

  it('never merges Google into a password account that has the same email', async () => {
    await createPasswordUserWithSession(db, { email: 'person@example.com' });
    const { agent, res } = await startAndFinish(new FakeGoogle());
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=email_in_use');
    expect((await agent.get('/api/me')).status).toBe(401);
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.googleSub).toBeNull();
  });

  it('a Google account cannot be signed into with a password it never set', async () => {
    await startAndFinish(new FakeGoogle());
    const attempt = await login(request.agent(app), { email: 'person@example.com' });
    expect(attempt.status).toBe(401);
  });

  it('the database refuses an account with no sign-in method', async () => {
    await expect(db.insert(users).values({ email: 'x@example.com', name: 'x' })).rejects.toThrow();
  });

  it('the database refuses two accounts for one email in different letter case', async () => {
    await createPasswordUserWithSession(db, { email: 'dup@example.com' });
    await expect(
      db.insert(users).values({ email: 'DUP@example.com', name: 'b', googleSub: 'sub-dup' }),
    ).rejects.toThrow();
  });
});

describe('rate limiting', () => {
  const mutableClock = () => {
    let t = new Date('2026-10-08T10:00:00Z').getTime();
    return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
  };
  type Keys = keyof ReturnType<typeof generousAuthLimiters>;
  const limiters = (now: () => Date, over: Partial<Record<Keys, number>>) => {
    const make = (key: Keys) =>
      createRateLimiter({ limit: over[key] ?? 1000, windowMs: 60_000, now });
    return {
      register: make('register'),
      loginIp: make('loginIp'),
      loginEmail: make('loginEmail'),
      emailSend: make('emailSend'),
      forgotIp: make('forgotIp'),
      tokenIp: make('tokenIp'),
      tokenAttempts: make('tokenAttempts'),
      link: make('link'),
    };
  };

  it('throttles sign-up per IP and recovers after the window', async () => {
    const clock = mutableClock();
    const limited = buildApp(db, testEnv(), undefined, {
      email,
      authLimiters: limiters(clock.now, { register: 2 }),
    });
    expect((await signUp(limited, { email: 'r1@example.com' })).status).toBe(202);
    expect((await signUp(limited, { email: 'r2@example.com' })).status).toBe(202);
    const blocked = await signUp(limited, { email: 'r3@example.com' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    clock.advance(61_000);
    expect((await signUp(limited, { email: 'r3@example.com' })).status).toBe(202);
  });

  it('limits emails sent to one address, so a victim’s inbox cannot be flooded', async () => {
    const limited = buildApp(db, testEnv(), undefined, {
      email,
      authLimiters: limiters(() => new Date(), { emailSend: 2 }),
    });
    expect((await signUp(limited)).status).toBe(202);
    expect((await signUp(limited)).status).toBe(202);
    expect((await signUp(limited)).status).toBe(429);
    expect(email.sent).toHaveLength(2);
  });

  it('throttles repeated guesses against one account, but not other accounts', async () => {
    await createPasswordUserWithSession(db);
    await createPasswordUserWithSession(db, { email: 'other@example.com' });
    const limited = buildApp(db, testEnv(), undefined, {
      email,
      authLimiters: limiters(() => new Date(), { loginEmail: 3 }),
    });
    for (let i = 0; i < 3; i += 1) {
      const res = await login(request.agent(limited), { password: `wrong password ${i}` });
      expect(res.status).toBe(401);
    }
    const blocked = await login(request.agent(limited));
    expect(blocked.status).toBe(429);
    expect(blocked.headers['set-cookie']).toBeUndefined();
    expect((await login(request.agent(limited), { email: 'other@example.com' })).status).toBe(200);
  });

  it('throttles login attempts per IP across different emails', async () => {
    const limited = buildApp(db, testEnv(), undefined, {
      email,
      authLimiters: limiters(() => new Date(), { loginIp: 2 }),
    });
    await login(request.agent(limited), { email: 'a@example.com' });
    await login(request.agent(limited), { email: 'b@example.com' });
    expect((await login(request.agent(limited), { email: 'c@example.com' })).status).toBe(429);
  });
});
