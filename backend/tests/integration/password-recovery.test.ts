import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession, hashToken } from '../../src/auth/sessions.js';
import { sessions, userTokens, users } from '../../src/db/schema.js';
import { createRateLimiter } from '../../src/lib/rateLimit.js';
import {
  FakeEmail,
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
const HOUR = 60 * 60 * 1000;
const NEW_PASSWORD = 'a completely new passphrase';
let email: FakeEmail;
let clock: { now: () => Date; advance: (ms: number) => void };
let app: ReturnType<typeof buildApp>;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  email = new FakeEmail();
  let t = new Date('2026-10-08T10:00:00Z').getTime();
  clock = { now: () => new Date(t), advance: (ms) => (t += ms) };
  app = buildApp(db, testEnv(), undefined, { email, now: clock.now });
});

const forgot = (address = 'pat@example.com', target = app) =>
  request(target).post('/api/auth/forgot-password').send({ email: address });
const reset = (token: string, password = NEW_PASSWORD, target = app) =>
  request(target).post('/api/auth/reset-password').send({ token, password });
const login = (password: string, address = 'pat@example.com') =>
  request(app).post('/api/auth/login').send({ email: address, password });

describe('POST /api/auth/forgot-password', () => {
  it('gives the same answer for a known address, an unknown one and a Google-only account', async () => {
    await createPasswordUserWithSession(db);
    await createUserWithSession(db, { email: 'google@example.com' });
    const known = await forgot('pat@example.com');
    const unknown = await forgot('nobody@example.com');
    const googleOnly = await forgot('google@example.com');
    for (const res of [known, unknown, googleOnly]) expect(res.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(googleOnly.body).toEqual(known.body);
    // Only the real password account gets a link.
    expect(email.to('pat@example.com')).toHaveLength(1);
    expect(email.to('nobody@example.com')).toHaveLength(0);
    expect(email.to('google@example.com')).toHaveLength(0);
  });

  it('emails a link that expires in one hour and stores only its hash', async () => {
    await createPasswordUserWithSession(db);
    await forgot();
    const token = email.lastToken('pat@example.com');
    expect(email.to('pat@example.com')[0]?.text).toMatch(/\/reset-password#token=/);
    const [row] = await db.select().from(userTokens);
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row?.expiresAt.getTime()).toBe(clock.now().getTime() + HOUR);
  });

  it('reports a server without email honestly', async () => {
    email.configured = false;
    const res = await forgot();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EMAIL_NOT_CONFIGURED');
  });

  it('validates the address', async () => {
    expect((await forgot('not-an-email')).status).toBe(422);
    expect((await request(app).post('/api/auth/forgot-password').send({})).status).toBe(422);
  });

  it('is rate limited per IP and per address', async () => {
    await createPasswordUserWithSession(db);
    const byIp = buildApp(db, testEnv(), undefined, {
      email,
      now: clock.now,
      authLimiters: {
        ...generousAuthLimiters(),
        forgotIp: createRateLimiter({ limit: 2, windowMs: HOUR, now: clock.now }),
      },
    });
    await forgot('a@example.com', byIp);
    await forgot('b@example.com', byIp);
    expect((await forgot('c@example.com', byIp)).status).toBe(429);

    const byAddress = buildApp(db, testEnv(), undefined, {
      email,
      now: clock.now,
      authLimiters: {
        ...generousAuthLimiters(),
        emailSend: createRateLimiter({ limit: 2, windowMs: HOUR, now: clock.now }),
      },
    });
    await forgot('pat@example.com', byAddress);
    await forgot('pat@example.com', byAddress);
    expect((await forgot('pat@example.com', byAddress)).status).toBe(429);
  });

  it('a newer link replaces the older one', async () => {
    await createPasswordUserWithSession(db);
    await forgot();
    const first = email.lastToken('pat@example.com');
    await forgot();
    const second = email.lastToken('pat@example.com');
    expect((await reset(first)).status).toBe(400);
    expect((await reset(second)).status).toBe(200);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password: the old one stops working and the new one signs in', async () => {
    await createPasswordUserWithSession(db);
    await forgot();
    const res = await reset(email.lastToken('pat@example.com'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'password_reset' });
    expect(res.headers['set-cookie']).toBeUndefined(); // no automatic sign-in
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
    const [user] = await db.select().from(users);
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('signs the account out everywhere', async () => {
    const owner = await createPasswordUserWithSession(db);
    const second = await createSession(db, owner.user.id, 14);
    const other = await createPasswordUserWithSession(db, { email: 'other@example.com' });
    await forgot();
    await reset(email.lastToken('pat@example.com'));

    for (const token of [owner.token, second.token]) {
      const res = await request(app).get('/api/me').set('Cookie', `noteflow_session=${token}`);
      expect(res.status).toBe(401);
    }
    expect(await db.select().from(sessions).where(eq(sessions.userId, owner.user.id))).toHaveLength(
      0,
    );
    // Someone else's session is untouched.
    expect((await request(app).get('/api/me').set('Cookie', other.cookie)).status).toBe(200);
  });

  it('rejects an unknown or malformed token', async () => {
    await createPasswordUserWithSession(db);
    const unknown = await reset('q'.repeat(43));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('TOKEN_INVALID');
    expect((await reset('short')).status).toBe(422);
  });

  it('rejects an expired token', async () => {
    await createPasswordUserWithSession(db);
    await forgot();
    const token = email.lastToken('pat@example.com');
    clock.advance(HOUR + 1000);
    const res = await reset(token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    expect((await login(PASSWORD)).status).toBe(200); // password unchanged
  });

  it('rejects a reused token, and leaves the first new password in place', async () => {
    await createPasswordUserWithSession(db);
    await forgot();
    const token = email.lastToken('pat@example.com');
    expect((await reset(token)).status).toBe(200);
    const again = await reset(token, 'a second attempted passphrase');
    expect(again.status).toBe(400);
    expect((await login(NEW_PASSWORD)).status).toBe(200);
    expect((await login('a second attempted passphrase')).status).toBe(401);
  });

  it('two simultaneous uses change the password once', async () => {
    await createPasswordUserWithSession(db);
    await forgot();
    const token = email.lastToken('pat@example.com');
    const results = await Promise.all([reset(token), reset(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('a weak password is refused without using up the link', async () => {
    await createPasswordUserWithSession(db);
    await forgot();
    const token = email.lastToken('pat@example.com');
    expect((await reset(token, 'short')).status).toBe(422);
    expect((await reset(token)).status).toBe(200);
  });

  it('a reset also proves the address for an account that was never verified', async () => {
    await createPasswordUserWithSession(db, { email: 'old@example.com', verified: false });
    await forgot('old@example.com');
    await reset(email.lastToken('old@example.com'));
    const res = await login(NEW_PASSWORD, 'old@example.com');
    expect(res.status).toBe(200);
  });

  it('a verification link cannot be used as a reset link', async () => {
    await createPasswordUserWithSession(db, { email: 'old@example.com', verified: false });
    await request(app).post('/api/auth/resend-verification').send({ email: 'old@example.com' });
    const verifyToken = email.lastToken('old@example.com');
    expect((await reset(verifyToken)).status).toBe(400);
  });

  it('limits attempts per link', async () => {
    await createPasswordUserWithSession(db);
    const limited = buildApp(db, testEnv(), undefined, {
      email,
      now: clock.now,
      authLimiters: {
        ...generousAuthLimiters(),
        tokenAttempts: createRateLimiter({ limit: 2, windowMs: HOUR, now: clock.now }),
      },
    });
    await reset('z'.repeat(43), NEW_PASSWORD, limited);
    await reset('z'.repeat(43), NEW_PASSWORD, limited);
    expect((await reset('z'.repeat(43), NEW_PASSWORD, limited)).status).toBe(429);
  });

  it('blocks a cross-origin reset', async () => {
    const res = await reset('q'.repeat(43)).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});
