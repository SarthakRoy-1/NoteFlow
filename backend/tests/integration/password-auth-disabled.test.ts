import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  oauthLinkAttempts,
  pendingRegistrations,
  sessions,
  userTokens,
  users,
} from '../../src/db/schema.js';
import { hashToken } from '../../src/auth/sessions.js';
import {
  buildApp,
  createPasswordUserWithSession,
  createUserWithSession,
  FakeEmail,
  FakeGoogle,
  openTestDb,
  PASSWORD,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
const origin = testEnv().APP_BASE_URL;
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

/** Everything custom auth could touch (incl. password hashes, via the user rows). */
async function snapshot() {
  return {
    users: await db.select().from(users),
    sessions: (await db.select().from(sessions)).length,
    pending: (await db.select().from(pendingRegistrations)).length,
    tokens: (await db.select().from(userTokens)).length,
    links: (await db.select().from(oauthLinkAttempts)).length,
  };
}

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } };

describe('custom password auth is disabled by default', () => {
  it('is off when ENABLE_PASSWORD_AUTH is not set', () => {
    expect(testEnv().ENABLE_PASSWORD_AUTH).toBe(false);
  });

  const posts = [
    ['register', { email: 'new@example.com', password: PASSWORD, name: 'New', timezone: 'UTC' }],
    ['login', { email: 'pat@example.com', password: PASSWORD }],
    ['resend-verification', { email: 'pat@example.com' }],
    ['verify-email', { token: 'a'.repeat(43), password: PASSWORD }],
    ['forgot-password', { email: 'pat@example.com' }],
    ['reset-password', { token: 'a'.repeat(43), password: PASSWORD }],
    ['link/google/start', { password: PASSWORD }],
  ] as const;

  it.each(posts)(
    'POST /api/auth/%s is a 404 that sends no email and changes nothing',
    async (path, body) => {
      const email = new FakeEmail();
      const app = buildApp(db, testEnv(), new FakeGoogle(), { email });
      const pat = await createPasswordUserWithSession(db, { email: 'pat@example.com' });
      const before = await snapshot();

      // Signed out, and signed in (the link route used to sit behind the session check).
      for (const cookie of [undefined, pat.cookie]) {
        const req = request(app).post(`/api/auth/${path}`).set('Origin', origin).send(body);
        const res = await (cookie ? req.set('Cookie', cookie) : req);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(NOT_FOUND);
        expect(res.headers['set-cookie']).toBeUndefined();
      }

      expect(email.sent).toHaveLength(0);
      expect(await snapshot()).toEqual(before);
    },
  );

  it('does not consume a leftover link attempt on the Google callback', async () => {
    const google = new FakeGoogle();
    const app = buildApp(db, testEnv(), google);
    const pat = await createPasswordUserWithSession(db, { email: 'pat@example.com' });
    await db.insert(oauthLinkAttempts).values({
      stateHash: hashToken('leftover-state'),
      userId: pat.user.id,
      sessionId: hashToken(pat.token),
      codeVerifier: 'v',
      nonce: 'n',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await request(app)
      .get('/api/auth/google/callback?code=c&state=leftover-state')
      .set('Cookie', pat.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?error=invalid_state');
    expect(google.completed).toHaveLength(0);
    expect(await db.select().from(oauthLinkAttempts)).toHaveLength(1);
    const [row] = await db.select().from(users).where(eq(users.id, pat.user.id));
    expect(row?.googleSub).toBeNull();
  });

  it('tells the UI that password auth is off', async () => {
    const res = await request(buildApp(db, testEnv())).get('/api/auth/config');
    expect(res.body).toEqual({ passwordAuthEnabled: false, emailEnabled: false });
  });

  it('keeps Google OAuth, sessions, logout and signed-out protection working', async () => {
    const google = new FakeGoogle();
    const agent = request.agent(buildApp(db, testEnv(), google));

    const start = await agent.get('/api/auth/google');
    expect(start.status).toBe(302);
    expect(start.headers.location).toContain('accounts.example.test/authorize');
    const state = google.started[0]?.state ?? '';

    const done = await agent.get(`/api/auth/google/callback?code=c&state=${state}`);
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe(`${origin}/`);
    expect((await agent.get('/api/me')).status).toBe(200);

    expect((await agent.post('/api/auth/logout').set('Origin', origin)).status).toBe(204);
    expect((await agent.get('/api/me')).status).toBe(401);
    expect((await request(buildApp(db, testEnv())).get('/api/notes')).status).toBe(401);
  });

  it('keeps per-user data isolation', async () => {
    const app = buildApp(db, testEnv());
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const note = await request(app)
      .post('/api/notes')
      .set('Origin', origin)
      .set('Cookie', a.cookie)
      .send({ title: 'mine', content: 'private' });
    expect(note.status).toBe(201);
    const id = (note.body as { note: { id: string } }).note.id;
    expect((await request(app).get(`/api/notes/${id}`).set('Cookie', b.cookie)).status).toBe(404);
    expect((await request(app).get(`/api/notes/${id}`).set('Cookie', a.cookie)).status).toBe(200);
  });

  it('can be re-enabled explicitly: the routes come back', async () => {
    const on = buildApp(db, testEnv({ ENABLE_PASSWORD_AUTH: 'true' }), undefined, {
      email: new FakeEmail(),
    });
    const res = await request(on).get('/api/auth/config');
    expect(res.body).toMatchObject({ passwordAuthEnabled: true });
    const login = await request(on)
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(login.status).not.toBe(404);
  });
});
