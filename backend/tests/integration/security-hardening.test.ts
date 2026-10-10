import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { askHistory, notes, reminders, todos } from '../../src/db/schema.js';
import { describeError, errorHandler } from '../../src/middleware/errorHandler.js';
import { FakeAI, item, reply } from '../helpers/fakeAi.js';
import {
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

function setup() {
  const ai = new FakeAI();
  const app = buildApp(db, testEnv(), undefined, { ai, aiCallsPerMinute: 10_000 });
  return { ai, app };
}

async function seedNote(userId: string, title = 'Source', content = 'Berlin trip in May') {
  const [n] = await db
    .insert(notes)
    .values({ userId, title, content, analysisStatus: 'ok' })
    .returning();
  if (!n) throw new Error('seed failed');
  return n;
}

describe('NUL characters are a validation error, not a server error', () => {
  const NUL = '\u0000';

  it.each([
    ['title', { title: `hello${NUL}world`, content: 'body' }],
    ['content', { title: 'ok', content: `body${NUL}more` }],
  ])('rejects a NUL in a new note %s with 422 and stores nothing', async (_field, body) => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const res = await request(app).post('/api/notes').set('Cookie', u.cookie).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await db.select().from(notes)).toHaveLength(0);
  });

  it('rejects a NUL when editing a note and keeps the saved text', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id, 'Keep me', 'original text');
    const res = await request(app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: `changed${NUL}` });
    expect(res.status).toBe(422);
    const [row] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(row?.content).toBe('original text');
  });

  it('rejects a NUL in a todo title, reminder text and reminder person', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    const [todo] = await db
      .insert(todos)
      .values({ userId: u.user.id, sourceNoteId: note.id, title: 'Original todo' })
      .returning();
    const [reminder] = await db
      .insert(reminders)
      .values({ userId: u.user.id, sourceNoteId: note.id, content: 'Original reminder' })
      .returning();
    if (!todo || !reminder) throw new Error('seed failed');

    const results = await Promise.all([
      request(app)
        .patch(`/api/todos/${todo.id}`)
        .set('Cookie', u.cookie)
        .send({ title: `a${NUL}b` }),
      request(app)
        .patch(`/api/reminders/${reminder.id}`)
        .set('Cookie', u.cookie)
        .send({ text: `a${NUL}b` }),
      request(app)
        .patch(`/api/reminders/${reminder.id}`)
        .set('Cookie', u.cookie)
        .send({ person: `a${NUL}b` }),
    ]);
    for (const res of results) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    const [t] = await db.select().from(todos).where(eq(todos.id, todo.id));
    const [r] = await db.select().from(reminders).where(eq(reminders.id, reminder.id));
    expect(t).toMatchObject({ title: 'Original todo', userModified: false });
    expect(r).toMatchObject({ content: 'Original reminder', person: null, userModified: false });
  });

  it('still accepts emoji and a lone surrogate (replaced by the driver) without a 500', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    for (const title of ['Plan 😀 trip', 'half \ud83d pair']) {
      const res = await request(app)
        .post('/api/notes')
        .set('Cookie', u.cookie)
        .send({ title, content: 'body' });
      expect(res.status).toBe(201);
    }
  });

  it('drops a model-produced item whose text contains a NUL instead of failing the analysis', async () => {
    const { app, ai } = setup();
    ai.respondWith(
      reply(
        item({ kind: 'todo', text: `Buy${NUL} milk`, evidence: 'buy milk' }),
        item({ kind: 'todo', text: 'Buy bread', evidence: 'buy bread' }),
      ),
    );
    const u = await createUserWithSession(db);
    const res = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Shopping', content: 'buy milk and buy bread' });
    expect(res.status).toBe(201);
    expect(res.body.note.analysis.status).toBe('ok');
    const rows = await db.select().from(todos);
    expect(rows.map((t) => t.title)).toEqual(['Buy bread']);
  });

  it('treats an Ask AI answer containing a NUL as unusable output (502), saving nothing', async () => {
    const { app, ai } = setup();
    const u = await createUserWithSession(db);
    await seedNote(u.user.id, 'Trip', 'Berlin trip in May');
    ai.respondWith(JSON.stringify({ answer: `Berlin${NUL}`, answerable: true, used_notes: [1] }));
    const res = await request(app)
      .post('/api/ask')
      .set('Cookie', u.cookie)
      .send({ question: 'Where is the trip?' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_BAD_OUTPUT');
    expect(await db.select().from(askHistory)).toHaveLength(0);
  });
});

describe('unexpected database errors never log user text', () => {
  it('describeError keeps the PostgreSQL code but not the statement or its parameters', async () => {
    // A genuine driver failure: a note for a user that does not exist (foreign-key violation).
    const secret = 'PRIVATE-NOTE-BODY-98765';
    const failure = await db
      .insert(notes)
      .values({
        userId: '11111111-1111-4111-8111-111111111111',
        title: 'Private title',
        content: secret,
      })
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    expect(failure).toBeDefined();
    // Precondition: the library's own message really does contain the user text.
    expect((failure as Error).message).toContain(secret);

    const described = JSON.stringify(describeError(failure));
    expect(described).not.toContain(secret);
    expect(described).not.toContain('Private title');
    expect(described).not.toMatch(/insert into|params/i);
    expect(described).toContain('23503'); // foreign_key_violation
  });

  it('the global error handler answers 500 with a generic message and logs no parameters', async () => {
    const secret = 'PRIVATE-NOTE-BODY-24680';
    const failure = await db
      .insert(notes)
      .values({
        userId: '22222222-2222-4222-8222-222222222222',
        title: 'T',
        content: secret,
      })
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const sent: { status?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        sent.status = code;
        return this;
      },
      json(body: unknown) {
        sent.body = body;
        return this;
      },
    } as unknown as Response;
    errorHandler(failure, {} as Request, res, () => undefined);
    spy.mockRestore();

    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain(secret);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]).toContain('Unhandled error');
  });
});

describe('API responses are never cacheable', () => {
  it('sends Cache-Control: no-store on success, auth failure, not-found and bad requests', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const responses = await Promise.all([
      request(app).get('/api/health'),
      request(app).get('/api/me').set('Cookie', u.cookie),
      request(app).get('/api/notes').set('Cookie', u.cookie),
      request(app).get('/api/me'), // 401
      request(app).get('/api/notes/not-a-uuid').set('Cookie', u.cookie), // 404
      request(app)
        .post('/api/notes')
        .set('Cookie', u.cookie)
        .set('Content-Type', 'application/json')
        .send('{broken'), // 400
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 401, 404, 400]);
    for (const res of responses) expect(res.headers['cache-control']).toBe('no-store');
  });
});
