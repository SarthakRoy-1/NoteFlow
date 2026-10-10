import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpired } from '../../src/auth/accountTokens.js';
import { createSession, hashToken } from '../../src/auth/sessions.js';
import { pendingRegistrations, sessions, userTokens, users } from '../../src/db/schema.js';
import { createRateLimiter } from '../../src/lib/rateLimit.js';
import {
  FakeEmail,
  FakeGoogle,
  PASSWORD,
  buildApp,
  createPasswordUserWithSession,
  generousAuthLimiters,
  openTestDb,
  resetDb,
  testEnv,
  PASSWORD_AUTH_ON,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
const HOUR = 60 * 60 * 1000;
let email: FakeEmail;
let clock: { now: () => Date; advance: (ms: number) => void };
let app: ReturnType<typeof buildApp>;

afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  email = new FakeEmail();
  let t = new Date('2026-10-08T10:00:00Z').getTime();
  clock = { now: () => new Date(t), advance: (ms) => (t += ms) };
  app = buildApp(db, testEnv(PASSWORD_AUTH_ON), undefined, { email, now: clock.now });
});

const signUp = (body: Record<string, unknown> = {}, target = app) =>
  request(target)
    .post('/api/auth/register')
    .send({ name: 'Pat Person', email: 'pat@example.com', password: PASSWORD, ...body });
const verify = (token: string, password = PASSWORD, target = app) =>
  request(target).post('/api/auth/verify-email').send({ token, password });
const resend = (address = 'pat@example.com', target = app) =>
  request(target).post('/api/auth/resend-verification').send({ email: address });

describe('verifying a new sign-up', () => {
  it('creates the account, marks the email verified, deletes the pending record and signs in', async () => {
    await signUp();
    const token = email.lastToken('pat@example.com');
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/verify-email').send({ token, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'pat@example.com', name: 'Pat Person' });
    expect(String(res.headers['set-cookie']?.[0])).toMatch(/noteflow_session=/);
    const [user] = await db.select().from(users);
    expect(user?.emailVerifiedAt).toEqual(clock.now());
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.googleSub).toBeNull();
    expect(await db.select().from(pendingRegistrations)).toHaveLength(0);
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('the chosen password signs in afterwards', async () => {
    await signUp();
    await verify(email.lastToken('pat@example.com'));
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pat@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('a wrong password is refused and the link stays usable with the right one', async () => {
    await signUp();
    const token = email.lastToken('pat@example.com');
    const bad = await verify(token, 'not the password I chose');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('PASSWORD_MISMATCH');
    expect(bad.headers['set-cookie']).toBeUndefined();
    expect(await db.select().from(users)).toHaveLength(0);
    expect((await verify(token)).status).toBe(200);
  });

  it.each([
    ['unknown token', 'x'.repeat(43)],
    ['wrong-length token', 'y'.repeat(30)],
  ])('rejects an %s', async (_label, token) => {
    await signUp();
    const res = await verify(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it.each([
    ['missing token', { password: PASSWORD }],
    ['too-short token', { token: 'abc', password: PASSWORD }],
    ['missing password', { token: 'z'.repeat(43) }],
    ['non-string token', { token: 12345, password: PASSWORD }],
  ])('rejects %s with a 422', async (_label, body) => {
    const res = await request(app).post('/api/auth/verify-email').send(body);
    expect(res.status).toBe(422);
  });

  it('a link works exactly once', async () => {
    await signUp();
    const token = email.lastToken('pat@example.com');
    expect((await verify(token)).status).toBe(200);
    const again = await verify(token);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID');
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('two simultaneous uses create one account', async () => {
    await signUp();
    const token = email.lastToken('pat@example.com');
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('an expired link is rejected with a clear error and creates nothing', async () => {
    await signUp();
    const token = email.lastToken('pat@example.com');
    clock.advance(24 * HOUR + 1000);
    const res = await verify(token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('a link still works just before it expires', async () => {
    await signUp();
    const token = email.lastToken('pat@example.com');
    clock.advance(24 * HOUR - 1000);
    expect((await verify(token)).status).toBe(200);
  });

  it('refuses when a real account took the address in the meantime, without a second account', async () => {
    await signUp();
    const token = email.lastToken('pat@example.com');
    await createPasswordUserWithSession(db, {
      email: 'pat@example.com',
      password: 'someone elses pass',
    });
    const res = await verify(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('limits guesses per link, even for the right password afterwards', async () => {
    const limited = buildApp(db, testEnv(PASSWORD_AUTH_ON), undefined, {
      email,
      now: clock.now,
      authLimiters: {
        ...generousAuthLimiters(),
        tokenAttempts: createRateLimiter({ limit: 3, windowMs: HOUR, now: clock.now }),
      },
    });
    await signUp({}, limited);
    const token = email.lastToken('pat@example.com');
    for (let i = 0; i < 3; i += 1)
      expect((await verify(`${token}`, `wrong ${i} password`, limited)).status).toBe(401);
    expect((await verify(token, PASSWORD, limited)).status).toBe(429);
  });

  it('limits token submissions per IP', async () => {
    const limited = buildApp(db, testEnv(PASSWORD_AUTH_ON), undefined, {
      email,
      now: clock.now,
      authLimiters: {
        ...generousAuthLimiters(),
        tokenIp: createRateLimiter({ limit: 2, windowMs: HOUR, now: clock.now }),
      },
    });
    await verify('a'.repeat(43), PASSWORD, limited);
    await verify('b'.repeat(43), PASSWORD, limited);
    expect((await verify('c'.repeat(43), PASSWORD, limited)).status).toBe(429);
  });
});

describe('an unverified sign-up cannot be used to take over an address', () => {
  it('someone who overwrites the pending sign-up cannot get the owner to finish it with their password', async () => {
    await signUp({ password: 'the owner password!' });
    // Attacker re-registers the same address with a password only they know.
    await signUp({ password: 'attacker chosen pass' });
    const linkTheOwnerReceives = email.lastToken('pat@example.com');
    // The owner clicks the emailed link and types the password they chose.
    const res = await verify(linkTheOwnerReceives, 'the owner password!');
    expect(res.status).toBe(401);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('does not block the real owner from signing in with Google', async () => {
    await signUp();
    const google = new FakeGoogle();
    google.identity = {
      sub: 'g-pat',
      email: 'pat@example.com',
      emailVerified: true,
      name: 'Pat G',
    };
    const agent = request.agent(
      buildApp(db, testEnv(PASSWORD_AUTH_ON), google, { email, now: clock.now }),
    );
    const start = await agent.get('/api/auth/google');
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const res = await agent.get(`/api/auth/google/callback?code=c&state=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('error=');
    expect((await agent.get('/api/me')).status).toBe(200);
    const [user] = await db.select().from(users);
    expect(user).toMatchObject({
      email: 'pat@example.com',
      googleSub: 'g-pat',
      passwordHash: null,
    });
    expect(user?.emailVerifiedAt).not.toBeNull();
    // The squatter's pending record is gone and its link no longer does anything.
    expect(await db.select().from(pendingRegistrations)).toHaveLength(0);
    const late = await verify(email.lastToken('pat@example.com'));
    expect(late.status).toBe(400);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('a pending sign-up never appears as an account (no user row, no session, no data access)', async () => {
    await signUp();
    expect(await db.select().from(users)).toHaveLength(0);
    expect((await request(app).get('/api/notes')).status).toBe(401);
  });
});

describe('accounts without a verified email', () => {
  it('are denied every protected route, even with a session', async () => {
    const legacy = await createPasswordUserWithSession(db, {
      email: 'old@example.com',
      verified: false,
    });
    for (const path of [
      '/api/me',
      '/api/notes',
      '/api/todos',
      '/api/reminders',
      '/api/ask/history',
    ]) {
      const res = await request(app).get(path).set('Cookie', legacy.cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    }
  });

  it('can verify through a resent link (and must know their password)', async () => {
    await createPasswordUserWithSession(db, { email: 'old@example.com', verified: false });
    expect((await resend('old@example.com')).status).toBe(202);
    const token = email.lastToken('old@example.com');

    expect((await verify(token, 'not my password')).status).toBe(401);
    const res = await verify(token);
    expect(res.status).toBe(200);
    const [user] = await db.select().from(users);
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect((await verify(token)).status).toBe(400); // single use
  });

  it('an expired legacy link is refused', async () => {
    await createPasswordUserWithSession(db, { email: 'old@example.com', verified: false });
    await resend('old@example.com');
    const token = email.lastToken('old@example.com');
    clock.advance(25 * HOUR);
    expect((await verify(token)).status).toBe(410);
  });
});

describe('resending the verification email', () => {
  it('replaces the link: the new one works, the old one does not', async () => {
    await signUp();
    const first = email.lastToken('pat@example.com');
    expect((await resend()).status).toBe(202);
    const second = email.lastToken('pat@example.com');
    expect(second).not.toBe(first);
    expect((await verify(first)).status).toBe(400);
    expect((await verify(second)).status).toBe(200);
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    await signUp();
    const known = await resend('pat@example.com');
    const unknown = await resend('nobody@example.com');
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(email.to('nobody@example.com')).toHaveLength(0);
  });

  it('does nothing for an address that already has a verified account', async () => {
    await createPasswordUserWithSession(db, { email: 'done@example.com' });
    expect((await resend('done@example.com')).status).toBe(202);
    expect(email.to('done@example.com')).toHaveLength(0);
  });

  it('is rate limited per address', async () => {
    const limited = buildApp(db, testEnv(PASSWORD_AUTH_ON), undefined, {
      email,
      now: clock.now,
      authLimiters: {
        ...generousAuthLimiters(),
        emailSend: createRateLimiter({ limit: 2, windowMs: HOUR, now: clock.now }),
      },
    });
    await signUp({}, limited);
    expect((await resend('pat@example.com', limited)).status).toBe(202);
    const blocked = await resend('pat@example.com', limited);
    expect(blocked.status).toBe(429);
    expect(email.to('pat@example.com')).toHaveLength(2);
  });

  it('reports missing email configuration instead of pretending', async () => {
    email.configured = false;
    expect((await resend()).status).toBe(503);
  });
});

describe('expiry and cleanup', () => {
  it('purges expired pending sign-ups and spent tokens, and never touches accounts or sessions', async () => {
    await signUp({ email: 'old@example.com' });
    clock.advance(25 * HOUR);
    await signUp({ email: 'fresh@example.com' }); // also runs the opportunistic purge
    const pending = await db.select().from(pendingRegistrations);
    expect(pending.map((p) => p.email)).toEqual(['fresh@example.com']);

    const keeper = await createPasswordUserWithSession(db, { email: 'keeper@example.com' });
    await db.insert(userTokens).values({
      userId: keeper.user.id,
      purpose: 'reset_password',
      tokenHash: 'expired-hash',
      expiresAt: new Date(clock.now().getTime() - 1000),
    });
    await purgeExpired(db, clock.now());
    expect(await db.select().from(userTokens)).toHaveLength(0);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('an address can sign up again once its earlier pending record has expired', async () => {
    await signUp();
    clock.advance(25 * HOUR);
    expect((await signUp()).status).toBe(202);
    expect(await db.select().from(pendingRegistrations)).toHaveLength(1);
    const token = email.lastToken('pat@example.com');
    expect((await verify(token)).status).toBe(200);
  });

  it('deleting a session leaves accounts intact', async () => {
    const u = await createPasswordUserWithSession(db);
    await db.delete(sessions).where(eq(sessions.id, hashToken(u.token)));
    expect(await db.select().from(users)).toHaveLength(1);
    await createSession(db, u.user.id, 14);
  });
});
