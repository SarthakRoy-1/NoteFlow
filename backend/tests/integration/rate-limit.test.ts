import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { askHistory, notes } from '../../src/db/schema.js';
import { AI_CALLS_PER_MINUTE, createRateLimiter } from '../../src/lib/rateLimit.js';
import { FakeAI } from '../helpers/fakeAi.js';
import {
  FIXED_NOW,
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
  PASSWORD_AUTH_ON,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const answer = (text = 'An answer.') => JSON.stringify({ answer: text, answerable: true });

/** App with a clock the test moves by hand. `perMinute` undefined = the real default (AI_CALLS_PER_MINUTE). */
function setup(perMinute?: number) {
  const ai = new FakeAI();
  const clock = { at: FIXED_NOW.getTime() };
  const app = buildApp(db, testEnv(PASSWORD_AUTH_ON), undefined, {
    ai,
    now: () => new Date(clock.at),
    aiCallsPerMinute: perMinute,
  });
  return { ai, app, clock };
}

async function seedNote(userId: string, title = 'Berlin trip', content = 'Berlin in May') {
  await db.insert(notes).values({ userId, title, content, analysisStatus: 'ok' });
}

const ask = (app: ReturnType<typeof setup>['app'], cookie: string, question = 'Berlin?') =>
  request(app).post('/api/ask').set('Cookie', cookie).send({ question });

const createNote = (app: ReturnType<typeof setup>['app'], cookie: string, title = 'A note') =>
  request(app).post('/api/notes').set('Cookie', cookie).send({ title, content: 'Buy milk' });

describe('createRateLimiter', () => {
  const make = (limit = 3) => {
    const clock = { at: 1_000_000 };
    const limiter = createRateLimiter({ limit, windowMs: 60_000, now: () => new Date(clock.at) });
    return { limiter, clock };
  };

  it('allows up to the limit, then refuses', () => {
    const { limiter } = make(3);
    expect([1, 2, 3, 4, 5].map(() => limiter.take('u'))).toEqual([true, true, true, false, false]);
  });

  it('keeps a separate allowance per key', () => {
    const { limiter } = make(1);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    expect(limiter.take('b')).toBe(true);
  });

  it('frees a use exactly when it leaves the window', () => {
    const { limiter, clock } = make(1);
    expect(limiter.take('u')).toBe(true);
    clock.at += 59_999;
    expect(limiter.take('u')).toBe(false);
    clock.at += 1;
    expect(limiter.take('u')).toBe(true);
  });

  it('does not count refused attempts against the user', () => {
    const { limiter, clock } = make(1);
    limiter.take('u');
    for (let i = 0; i < 20; i++) expect(limiter.take('u')).toBe(false);
    clock.at += 60_000;
    expect(limiter.take('u')).toBe(true);
  });
});

describe('Ask AI rate limit', () => {
  it('allows the default number of questions a minute, then answers 429 without calling the AI', async () => {
    const { app, ai } = setup();
    const u = await createUserWithSession(db);
    await seedNote(u.user.id);
    for (let i = 0; i < AI_CALLS_PER_MINUTE; i++) ai.respondWith(answer());

    for (let i = 0; i < AI_CALLS_PER_MINUTE; i++)
      expect((await ask(app, u.cookie)).status).toBe(201);
    const limited = await ask(app, u.cookie);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('AI_RATE_LIMITED');
    expect(ai.requests).toHaveLength(AI_CALLS_PER_MINUTE);
    expect(await db.select().from(askHistory)).toHaveLength(AI_CALLS_PER_MINUTE);
  });

  it('works again once the minute has passed', async () => {
    const { app, ai, clock } = setup(1);
    const u = await createUserWithSession(db);
    await seedNote(u.user.id);
    ai.respondWith(answer(), answer());
    expect((await ask(app, u.cookie)).status).toBe(201);
    expect((await ask(app, u.cookie)).status).toBe(429);
    clock.at += 60_000;
    expect((await ask(app, u.cookie)).status).toBe(201);
    expect(ai.requests).toHaveLength(2);
  });

  it('does not let one user’s limit block another user', async () => {
    const { app, ai } = setup(1);
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedNote(a.user.id);
    await seedNote(b.user.id);
    ai.respondWith(answer('A'), answer('B'));
    expect((await ask(app, a.cookie)).status).toBe(201);
    expect((await ask(app, a.cookie)).status).toBe(429);
    const other = await ask(app, b.cookie);
    expect(other.status).toBe(201);
    expect(other.body.ask.answer).toBe('B');
  });

  it('does not count questions that never reach the AI', async () => {
    const { app, ai } = setup(1);
    const u = await createUserWithSession(db);
    await seedNote(u.user.id);
    for (let i = 0; i < 5; i++) {
      const res = await ask(app, u.cookie, 'quantum chromodynamics');
      expect(res.status).toBe(201);
    }
    ai.respondWith(answer());
    expect((await ask(app, u.cookie)).status).toBe(201);
    expect(ai.requests).toHaveLength(1);
  });

  it('still rejects an unauthenticated request with 401, not 429', async () => {
    const { app } = setup(1);
    expect((await request(app).post('/api/ask').send({ question: 'Berlin?' })).status).toBe(401);
  });
});

describe('note analysis rate limit', () => {
  it('saves the note but skips the AI once over the limit', async () => {
    const { app, ai } = setup(2);
    const u = await createUserWithSession(db);
    expect((await createNote(app, u.cookie, 'one')).body.note.analysis.status).toBe('ok');
    expect((await createNote(app, u.cookie, 'two')).body.note.analysis.status).toBe('ok');

    const third = await createNote(app, u.cookie, 'three');
    expect(third.status).toBe(201);
    expect(third.body.note.title).toBe('three');
    expect(third.body.note.analysis.status).toBe('failed');
    expect(third.body.note.analysis.error).toMatch(/note was saved/i);
    expect(ai.requests).toHaveLength(2);
    expect(await db.select().from(notes)).toHaveLength(3);
  });

  it('keeps edits that change a note even when the AI is skipped', async () => {
    const { app, ai } = setup(1);
    const u = await createUserWithSession(db);
    const made = await createNote(app, u.cookie, 'first');
    const edited = await request(app)
      .patch(`/api/notes/${made.body.note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: 'Buy bread' });
    expect(edited.status).toBe(200);
    expect(edited.body.note.content).toBe('Buy bread');
    expect(edited.body.note.analysis.status).toBe('failed');
    expect(ai.requests).toHaveLength(1);
  });

  it('answers 429 to “retry analysis” while limited, then succeeds after a minute', async () => {
    const { app, ai, clock } = setup(1);
    const u = await createUserWithSession(db);
    await createNote(app, u.cookie, 'one'); // uses the allowance
    const limitedNote = await createNote(app, u.cookie, 'two'); // saved, analysis skipped
    const id = limitedNote.body.note.id;

    const retry = await request(app).post(`/api/notes/${id}/analyze`).set('Cookie', u.cookie);
    expect(retry.status).toBe(429);
    expect(retry.body.error.code).toBe('AI_RATE_LIMITED');
    expect(ai.requests).toHaveLength(1);

    clock.at += 60_000;
    const ok = await request(app).post(`/api/notes/${id}/analyze`).set('Cookie', u.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.note.analysis.status).toBe('ok');
    expect(ai.requests).toHaveLength(2);
    const [row] = await db.select().from(notes).where(eq(notes.id, id));
    expect(row?.analysisStatus).toBe('ok');
  });

  it('does not let one user’s notes use another user’s allowance', async () => {
    const { app, ai } = setup(1);
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await createNote(app, a.cookie);
    expect((await createNote(app, a.cookie)).body.note.analysis.status).toBe('failed');
    expect((await createNote(app, b.cookie)).body.note.analysis.status).toBe('ok');
    expect(ai.requests).toHaveLength(2);
  });

  it('shares one allowance between note analysis and Ask AI', async () => {
    const { app, ai } = setup(2);
    const u = await createUserWithSession(db);
    await seedNote(u.user.id);
    await createNote(app, u.cookie); // call 1 (the fake AI's default reply: nothing actionable)
    ai.respondWith(answer());
    expect((await ask(app, u.cookie)).status).toBe(201); // call 2
    expect((await ask(app, u.cookie)).status).toBe(429);
    expect((await createNote(app, u.cookie, 'later')).body.note.analysis.status).toBe('failed');
    expect(ai.requests).toHaveLength(2);
  });
});
