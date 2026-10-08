import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/auth/sessions.js';
import { sessions, users } from '../../src/db/schema.js';
import {
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
const app = buildApp(db);
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

describe('public endpoints', () => {
  it('GET /api/health is public and works', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('requireAuth', () => {
  it('rejects a request with no session cookie (401 envelope)', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' },
    });
  });

  it('also rejects unknown /api paths when signed out (does not reveal routes)', async () => {
    expect((await request(app).get('/api/nope')).status).toBe(401);
  });

  it('rejects an unknown/invalid session token', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', 'noteflow_session=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const { cookie } = await createUserWithSession(db, { expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('accepts a valid session and resolves the right user', async () => {
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const resA = await request(app).get('/api/me').set('Cookie', a.cookie);
    const resB = await request(app).get('/api/me').set('Cookie', b.cookie);
    expect(resA.status).toBe(200);
    expect(resA.body.user).toEqual({
      id: a.user.id,
      email: 'a@example.com',
      name: 'a',
      timezone: 'UTC',
    });
    expect(resB.body.user.id).toBe(b.user.id);
  });

  it('stores only a hash of the token and ties the session to its user', async () => {
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(a.token);
    expect(rows[0]?.id).toBe(hashToken(a.token));
    expect(rows[0]?.userId).toBe(a.user.id);
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('never exposes the user’s google_sub or the session hash', async () => {
    const a = await createUserWithSession(db);
    const res = await request(app).get('/api/me').set('Cookie', a.cookie);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(a.user.googleSub);
    expect(body).not.toContain(hashToken(a.token));
  });
});

describe('client cannot choose the user', () => {
  it('ignores ?user_id on GET /api/me', async () => {
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const res = await request(app).get(`/api/me?user_id=${b.user.id}`).set('Cookie', a.cookie);
    expect(res.body.user.id).toBe(a.user.id);
  });

  it('rejects user_id in the PATCH body and leaves the other user untouched', async () => {
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const res = await request(app)
      .patch('/api/me')
      .set('Cookie', a.cookie)
      .send({ timezone: 'Asia/Tokyo', user_id: b.user.id });
    expect(res.status).toBe(422);
    const [bRow] = await db.select().from(users).where(eq(users.id, b.user.id));
    expect(bRow?.timezone).toBe('UTC');
  });
});

describe('PATCH /api/me (timezone)', () => {
  it('requires authentication', async () => {
    const res = await request(app).patch('/api/me').send({ timezone: 'Europe/London' });
    expect(res.status).toBe(401);
  });

  it.each(['Europe/London', 'America/New_York', 'Asia/Kolkata', 'UTC'])(
    'accepts valid IANA timezone %s',
    async (timezone) => {
      const a = await createUserWithSession(db);
      const res = await request(app).patch('/api/me').set('Cookie', a.cookie).send({ timezone });
      expect(res.status).toBe(200);
      expect(res.body.user.timezone).toBe(timezone);
      const [row] = await db.select().from(users).where(eq(users.id, a.user.id));
      expect(row?.timezone).toBe(timezone);
    },
  );

  it.each(['Mars/Olympus', 'EST', '', 'not a zone', '+05:30'])(
    'rejects invalid timezone %j',
    async (timezone) => {
      const a = await createUserWithSession(db);
      const res = await request(app).patch('/api/me').set('Cookie', a.cookie).send({ timezone });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const [row] = await db.select().from(users).where(eq(users.id, a.user.id));
      expect(row?.timezone).toBe('UTC');
    },
  );

  it('rejects a missing or non-string timezone', async () => {
    const a = await createUserWithSession(db);
    for (const body of [{}, { timezone: 5 }]) {
      const res = await request(app).patch('/api/me').set('Cookie', a.cookie).send(body);
      expect(res.status).toBe(422);
    }
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the server-side session, clears the cookie, and the old cookie stops working', async () => {
    const a = await createUserWithSession(db);
    const out = await request(app).post('/api/auth/logout').set('Cookie', a.cookie);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/noteflow_session=;/);
    expect(await db.select().from(sessions)).toHaveLength(0);

    const after = await request(app).get('/api/me').set('Cookie', a.cookie);
    expect(after.status).toBe(401);
  });

  it('only removes the caller’s own session', async () => {
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await request(app).post('/api/auth/logout').set('Cookie', a.cookie);
    expect((await request(app).get('/api/me').set('Cookie', b.cookie)).status).toBe(200);
  });

  it('is safe when already signed out', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
    const res = await request(app).post('/api/auth/logout').set('Cookie', 'noteflow_session=junk');
    expect(res.status).toBe(204);
  });
});

describe('origin check', () => {
  it('blocks a state-changing request from a foreign Origin', async () => {
    const a = await createUserWithSession(db);
    const res = await request(app)
      .patch('/api/me')
      .set('Cookie', a.cookie)
      .set('Origin', 'https://evil.example')
      .send({ timezone: 'Asia/Tokyo' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('allows the configured frontend Origin', async () => {
    const a = await createUserWithSession(db);
    const res = await request(app)
      .patch('/api/me')
      .set('Cookie', a.cookie)
      .set('Origin', testEnv().APP_BASE_URL)
      .send({ timezone: 'Asia/Tokyo' });
    expect(res.status).toBe(200);
  });

  it('does not restrict safe methods', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });
});

describe('error envelope', () => {
  it('malformed JSON yields a 400 envelope without leaking internals', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|stack/i);
  });
});
