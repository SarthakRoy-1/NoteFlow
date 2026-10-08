import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { aiDismissed, notes, todos } from '../../src/db/schema.js';
import { FakeAI, item, reply } from '../helpers/fakeAi.js';
import {
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
  type TestDb,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const NIL_UUID = '00000000-0000-4000-8000-000000000000';

function setup() {
  const ai = new FakeAI();
  const app = buildApp(db, testEnv(), undefined, { ai });
  return { ai, app };
}

async function seedNote(userId: string, title = 'Source note') {
  const [n] = await db
    .insert(notes)
    .values({ userId, title, content: 'content', analysisStatus: 'ok' })
    .returning();
  if (!n) throw new Error('seed failed');
  return n;
}

async function seedTodo(
  d: TestDb,
  userId: string,
  noteId: string,
  partial: Partial<typeof todos.$inferInsert> = {},
) {
  const [t] = await d
    .insert(todos)
    .values({ userId, sourceNoteId: noteId, title: 'Buy milk', ...partial })
    .returning();
  if (!t) throw new Error('seed failed');
  return t;
}

const row = async (id: string) => (await db.select().from(todos).where(eq(todos.id, id)))[0];

describe('authentication required', () => {
  it('rejects list, get, patch and delete without a session and changes nothing', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    const t = await seedTodo(db, u.user.id, note.id);
    const url = `/api/todos/${t.id}`;
    const results = await Promise.all([
      request(app).get('/api/todos'),
      request(app).get(url),
      request(app).patch(url).send({ completed: true }),
      request(app).delete(url),
    ]);
    for (const res of results) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(await row(t.id)).toMatchObject({ completed: false, title: 'Buy milk' });
  });

  it('rejects an expired session', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db, { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).get('/api/todos').set('Cookie', u.cookie)).status).toBe(401);
  });
});

describe('GET /api/todos', () => {
  it('returns an empty list for a new user', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const res = await request(app).get('/api/todos').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todos: [] });
  });

  it("returns only the caller's todos", async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedTodo(db, a.user.id, (await seedNote(a.user.id)).id, { title: 'A todo' });
    await seedTodo(db, b.user.id, (await seedNote(b.user.id, 'B note')).id, { title: 'B secret' });
    const res = await request(app).get('/api/todos').set('Cookie', a.cookie);
    expect(res.body.todos.map((t: { title: string }) => t.title)).toEqual(['A todo']);
    expect(JSON.stringify(res.body)).not.toMatch(/B secret|B note/);
  });

  it('ignores a user_id query parameter', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedTodo(db, b.user.id, (await seedNote(b.user.id)).id);
    const res = await request(app).get(`/api/todos?user_id=${b.user.id}`).set('Cookie', a.cookie);
    expect(res.body.todos).toEqual([]);
  });

  it('includes the source note (id and title) and only safe fields', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id, 'Groceries');
    await seedTodo(db, u.user.id, note.id, { createdByAi: true, aiFingerprint: 'secret-fp' });
    const res = await request(app).get('/api/todos').set('Cookie', u.cookie);
    const [todo] = res.body.todos;
    expect(todo.sourceNote).toEqual({ id: note.id, title: 'Groceries' });
    expect(todo.createdByAi).toBe(true);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('secret-fp');
    expect(text).not.toContain(u.user.id);
    expect(Object.keys(todo)).not.toContain('aiFingerprint');
    expect(Object.keys(todo)).not.toContain('userId');
  });

  it('orders open todos first, soonest due first, undated last, completed at the end', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const n = (await seedNote(u.user.id)).id;
    await seedTodo(db, u.user.id, n, { title: 'undated' });
    await seedTodo(db, u.user.id, n, { title: 'later', dueAt: new Date('2026-12-01T00:00:00Z') });
    await seedTodo(db, u.user.id, n, { title: 'soon', dueAt: new Date('2026-10-10T00:00:00Z') });
    await seedTodo(db, u.user.id, n, {
      title: 'done-early',
      completed: true,
      dueAt: new Date('2026-01-01T00:00:00Z'),
    });
    const res = await request(app).get('/api/todos').set('Cookie', u.cookie);
    expect(res.body.todos.map((t: { title: string }) => t.title)).toEqual([
      'soon',
      'later',
      'undated',
      'done-early',
    ]);
  });

  it('filters by status and falls back to "all" for junk values', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const n = (await seedNote(u.user.id)).id;
    await seedTodo(db, u.user.id, n, { title: 'open one' });
    await seedTodo(db, u.user.id, n, { title: 'done one', completed: true });
    const titles = async (q: string) =>
      (await request(app).get(`/api/todos${q}`).set('Cookie', u.cookie)).body.todos.map(
        (t: { title: string }) => t.title,
      );
    expect(await titles('?status=open')).toEqual(['open one']);
    expect(await titles('?status=done')).toEqual(['done one']);
    expect(await titles('?status=all')).toHaveLength(2);
    expect(await titles('?status=bogus')).toHaveLength(2);
  });

  it('shows todos the AI created when a note was saved (Phase 3 -> Phase 4)', async () => {
    const { app, ai } = setup();
    ai.respondWith(
      reply(
        item({
          text: 'Buy milk',
          evidence: 'buy milk',
          due_kind: 'date',
          due_expression: 'tomorrow',
          due_local: '2026-10-09',
        }),
      ),
    );
    const u = await createUserWithSession(db, { timezone: 'Asia/Kolkata' });
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Groceries', content: 'buy milk tomorrow' });
    const res = await request(app).get('/api/todos').set('Cookie', u.cookie);
    expect(res.body.todos).toHaveLength(1);
    expect(res.body.todos[0]).toMatchObject({
      title: 'Buy milk',
      completed: false,
      createdByAi: true,
      dueHasTime: false,
      dueAt: '2026-10-09T18:29:59.999Z',
      sourceNote: { id: created.body.note.id, title: 'Groceries' },
    });
  });

  it('disappears from the list when its source note is deleted', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    await seedTodo(db, u.user.id, note.id);
    await request(app).delete(`/api/notes/${note.id}`).set('Cookie', u.cookie);
    expect((await request(app).get('/api/todos').set('Cookie', u.cookie)).body.todos).toEqual([]);
  });
});

describe('GET /api/todos/:id', () => {
  it('returns the caller’s todo', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const t = await seedTodo(db, u.user.id, (await seedNote(u.user.id)).id);
    const res = await request(app).get(`/api/todos/${t.id}`).set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.todo).toMatchObject({ id: t.id, title: 'Buy milk' });
  });

  it('returns 404 for another user’s todo without revealing anything', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const t = await seedTodo(db, a.user.id, (await seedNote(a.user.id, 'private note')).id, {
      title: 'private todo',
    });
    const res = await request(app).get(`/api/todos/${t.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/private/);
  });

  it.each([NIL_UUID, 'not-a-uuid', '1', "' or 1=1 --"])('returns 404 for id %j', async (id) => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const res = await request(app)
      .get(`/api/todos/${encodeURIComponent(id)}`)
      .set('Cookie', u.cookie);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/todos/:id', () => {
  async function one(partial: Partial<typeof todos.$inferInsert> = {}, tz = 'Asia/Kolkata') {
    const { app, ai } = setup();
    const u = await createUserWithSession(db, { timezone: tz });
    const note = await seedNote(u.user.id);
    const t = await seedTodo(db, u.user.id, note.id, partial);
    const patch = (body: object) =>
      request(app).patch(`/api/todos/${t.id}`).set('Cookie', u.cookie).send(body);
    return { app, ai, u, note, t, patch };
  }

  it('edits the text (trimmed) and marks the todo as user-modified', async () => {
    const { t, patch } = await one();
    const res = await patch({ title: '  Buy oat milk  ' });
    expect(res.status).toBe(200);
    expect(res.body.todo.title).toBe('Buy oat milk');
    expect(await row(t.id)).toMatchObject({ title: 'Buy oat milk', userModified: true });
  });

  it('marks done and undone, persisting to the database', async () => {
    const { t, patch } = await one();
    const done = await patch({ completed: true });
    expect(done.body.todo.completed).toBe(true);
    expect(done.body.todo.completedAt).not.toBeNull();
    expect(await row(t.id)).toMatchObject({ completed: true });
    expect((await row(t.id))?.completedAt).toBeInstanceOf(Date);

    const undone = await patch({ completed: false });
    expect(undone.body.todo).toMatchObject({ completed: false, completedAt: null });
    expect(await row(t.id)).toMatchObject({ completed: false, completedAt: null });
  });

  it('keeps completion across a fresh app instance (state lives in PostgreSQL)', async () => {
    const { u, t, patch } = await one();
    await patch({ completed: true });
    const fresh = buildApp(db, testEnv());
    const res = await request(fresh).get(`/api/todos/${t.id}`).set('Cookie', u.cookie);
    expect(res.body.todo.completed).toBe(true);
  });

  it('toggling completion alone does not mark the todo user-modified', async () => {
    const { t, patch } = await one();
    await patch({ completed: true });
    expect((await row(t.id))?.userModified).toBe(false);
  });

  it('sets a date-only due date at the end of that day in the user timezone, with no invented time', async () => {
    const { patch } = await one();
    const res = await patch({ due: { date: '2026-10-09' } });
    expect(res.body.todo).toMatchObject({
      dueHasTime: false,
      dueAt: '2026-10-09T18:29:59.999Z', // 23:59:59.999 IST
    });
  });

  it('sets a due date and time in the user timezone', async () => {
    const { patch } = await one({}, 'America/New_York');
    const res = await patch({ due: { date: '2026-10-09', time: '17:00' } });
    expect(res.body.todo).toMatchObject({ dueHasTime: true, dueAt: '2026-10-09T21:00:00.000Z' });
  });

  it('respects daylight saving when converting the due time', async () => {
    const { patch } = await one({}, 'America/New_York');
    expect((await patch({ due: { date: '2026-11-02', time: '09:00' } })).body.todo.dueAt).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  it('clears the due date with null', async () => {
    const { patch, t } = await one({ dueAt: new Date('2026-10-09T00:00:00Z'), dueHasTime: true });
    const res = await patch({ due: null });
    expect(res.body.todo).toMatchObject({ dueAt: null, dueHasTime: false });
    expect(await row(t.id)).toMatchObject({ dueAt: null, userModified: true });
  });

  it('applies several fields at once', async () => {
    const { patch } = await one();
    const res = await patch({ title: 'New', completed: true, due: { date: '2026-10-12' } });
    expect(res.body.todo).toMatchObject({ title: 'New', completed: true, dueHasTime: false });
  });

  it('changes updated_at', async () => {
    const { patch, t } = await one();
    const before = (await row(t.id))?.updatedAt.getTime() ?? 0;
    await new Promise((r) => setTimeout(r, 15));
    await patch({ completed: true });
    expect((await row(t.id))?.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it.each([
    ['empty body', {}],
    ['blank title', { title: '   ' }],
    ['empty title', { title: '' }],
    ['too-long title', { title: 'x'.repeat(201) }],
    ['non-string title', { title: 5 }],
    ['non-boolean completed', { completed: 'yes' }],
    ['null completed', { completed: null }],
    ['due as a string', { due: '2026-10-09' }],
    ['due without date', { due: { time: '10:00' } }],
    ['malformed date', { due: { date: '09/10/2026' } }],
    ['impossible date', { due: { date: '2026-02-31' } }],
    ['malformed time', { due: { date: '2026-10-09', time: '5pm' } }],
    ['impossible time', { due: { date: '2026-10-09', time: '25:00' } }],
    ['date far in the future', { due: { date: '2500-01-01' } }],
    ['date far in the past', { due: { date: '1970-01-01' } }],
    ['unknown key inside due', { due: { date: '2026-10-09', zone: 'UTC' } }],
  ])('rejects %s with 422 and changes nothing', async (_name, body) => {
    const { patch, t } = await one();
    const res = await patch(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await row(t.id)).toMatchObject({
      title: 'Buy milk',
      completed: false,
      dueAt: null,
      userModified: false,
    });
  });

  it.each([
    ['user_id', { user_id: NIL_UUID }],
    ['userId', { userId: NIL_UUID }],
    ['source_note_id', { source_note_id: NIL_UUID }],
    ['sourceNoteId', { sourceNoteId: NIL_UUID }],
    ['ai_fingerprint', { ai_fingerprint: 'forged' }],
    ['aiFingerprint', { aiFingerprint: 'forged' }],
    ['created_by_ai', { created_by_ai: true }],
    ['createdByAi', { createdByAi: true }],
    ['user_modified', { userModified: false }],
    ['id', { id: NIL_UUID }],
    ['completedAt', { completedAt: '2000-01-01T00:00:00Z' }],
    ['createdAt', { createdAt: '2000-01-01T00:00:00Z' }],
    ['dueAt (raw instant)', { dueAt: '2026-10-09T00:00:00Z' }],
  ])('rejects the forbidden field %s and changes nothing', async (_name, extra) => {
    const { patch, t, u } = await one({ createdByAi: false });
    const res = await patch({ title: 'ok', ...extra });
    expect(res.status).toBe(422);
    expect(await row(t.id)).toMatchObject({
      title: 'Buy milk',
      userId: u.user.id,
      aiFingerprint: null,
      createdByAi: false,
    });
  });

  it('cannot move a todo to another user’s note (source_note_id injection)', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const noteA = await seedNote(a.user.id, 'A note');
    const noteB = await seedNote(b.user.id, 'B note');
    const t = await seedTodo(db, a.user.id, noteA.id);
    const res = await request(app)
      .patch(`/api/todos/${t.id}`)
      .set('Cookie', a.cookie)
      .send({ source_note_id: noteB.id, title: 'x' });
    expect(res.status).toBe(422);
    expect((await row(t.id))?.sourceNoteId).toBe(noteA.id);
    // and the database itself refuses a cross-owner reference
    await expect(
      db.update(todos).set({ sourceNoteId: noteB.id }).where(eq(todos.id, t.id)),
    ).rejects.toThrow();
  });

  it('cannot edit another user’s todo, which stays untouched', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const t = await seedTodo(db, a.user.id, (await seedNote(a.user.id)).id);
    for (const body of [
      { title: 'hijack' },
      { completed: true },
      { due: { date: '2026-10-09' } },
    ]) {
      const res = await request(app).patch(`/api/todos/${t.id}`).set('Cookie', b.cookie).send(body);
      expect(res.status).toBe(404);
    }
    expect(await row(t.id)).toMatchObject({
      title: 'Buy milk',
      completed: false,
      dueAt: null,
      userId: a.user.id,
    });
  });

  it('returns 404 for missing or malformed ids', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    for (const id of [NIL_UUID, 'garbage']) {
      const res = await request(app)
        .patch(`/api/todos/${id}`)
        .set('Cookie', u.cookie)
        .send({ title: 'x' });
      expect(res.status).toBe(404);
    }
  });

  it('blocks cross-origin writes', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const t = await seedTodo(db, u.user.id, (await seedNote(u.user.id)).id);
    const res = await request(app)
      .patch(`/api/todos/${t.id}`)
      .set('Cookie', u.cookie)
      .set('Origin', 'https://evil.example')
      .send({ completed: true });
    expect(res.status).toBe(403);
    expect((await row(t.id))?.completed).toBe(false);
  });
});

describe('DELETE /api/todos/:id', () => {
  it('deletes the caller’s todo (204) and it is gone', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const t = await seedTodo(db, u.user.id, (await seedNote(u.user.id)).id);
    const res = await request(app).delete(`/api/todos/${t.id}`).set('Cookie', u.cookie);
    expect(res.status).toBe(204);
    expect(await row(t.id)).toBeUndefined();
    expect((await request(app).get(`/api/todos/${t.id}`).set('Cookie', u.cookie)).status).toBe(404);
    expect((await request(app).delete(`/api/todos/${t.id}`).set('Cookie', u.cookie)).status).toBe(
      404,
    );
  });

  it('does not delete the source note', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    const t = await seedTodo(db, u.user.id, note.id);
    await request(app).delete(`/api/todos/${t.id}`).set('Cookie', u.cookie);
    expect(await db.select().from(notes).where(eq(notes.id, note.id))).toHaveLength(1);
  });

  it('cannot delete another user’s todo; only the caller’s own data is affected', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const tA = await seedTodo(db, a.user.id, (await seedNote(a.user.id)).id, { title: 'A' });
    const tB = await seedTodo(db, b.user.id, (await seedNote(b.user.id)).id, { title: 'B' });
    const res = await request(app).delete(`/api/todos/${tA.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
    expect((await db.select().from(todos)).map((t) => t.id).sort()).toEqual([tA.id, tB.id].sort());
    expect(await db.select().from(aiDismissed)).toHaveLength(0);
  });

  it('returns 404 for a malformed id', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    expect((await request(app).delete('/api/todos/xyz').set('Cookie', u.cookie)).status).toBe(404);
  });

  it('records a tombstone for an AI-created todo, but not for a manual one', async () => {
    const { app } = setup();
    const u = await createUserWithSession(db);
    const note = await seedNote(u.user.id);
    const ai = await seedTodo(db, u.user.id, note.id, { createdByAi: true, aiFingerprint: 'fp-1' });
    const manual = await seedTodo(db, u.user.id, note.id, { title: 'manual' });
    await request(app).delete(`/api/todos/${ai.id}`).set('Cookie', u.cookie);
    await request(app).delete(`/api/todos/${manual.id}`).set('Cookie', u.cookie);
    const stones = await db.select().from(aiDismissed);
    expect(stones).toHaveLength(1);
    expect(stones[0]).toMatchObject({
      userId: u.user.id,
      sourceNoteId: note.id,
      kind: 'todo',
      aiFingerprint: 'fp-1',
    });
  });

  it('a deleted AI todo does not come back when the note is edited and re-analysed', async () => {
    const { app, ai } = setup();
    const milk = reply(item({ text: 'Buy milk', evidence: 'buy milk' }));
    ai.respondWith(milk, milk);
    const u = await createUserWithSession(db);
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'T', content: 'buy milk' });
    const [t] = await db.select().from(todos);
    await request(app).delete(`/api/todos/${t?.id}`).set('Cookie', u.cookie);
    await request(app)
      .patch(`/api/notes/${created.body.note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: 'buy milk please' });
    expect(await db.select().from(todos)).toHaveLength(0);
  });
});

describe('interaction with re-analysis (Phase 3 semantics preserved)', () => {
  it('a user-edited todo survives a note edit that no longer mentions it, with its edits intact', async () => {
    const { app, ai } = setup();
    ai.respondWith(reply(item({ text: 'Buy milk', evidence: 'buy milk' })), reply());
    const u = await createUserWithSession(db);
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'T', content: 'buy milk' });
    const [t] = await db.select().from(todos);
    await request(app)
      .patch(`/api/todos/${t?.id}`)
      .set('Cookie', u.cookie)
      .send({ title: 'Buy oat milk', due: { date: '2026-10-20' } });
    await request(app)
      .patch(`/api/notes/${created.body.note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: 'nothing here now' });
    const after = await db.select().from(todos);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ title: 'Buy oat milk', userModified: true });
  });

  it('a completed todo survives a note edit that no longer mentions it', async () => {
    const { app, ai } = setup();
    ai.respondWith(reply(item({ text: 'Buy milk', evidence: 'buy milk' })), reply());
    const u = await createUserWithSession(db);
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'T', content: 'buy milk' });
    const [t] = await db.select().from(todos);
    await request(app)
      .patch(`/api/todos/${t?.id}`)
      .set('Cookie', u.cookie)
      .send({ completed: true });
    await request(app)
      .patch(`/api/notes/${created.body.note.id}`)
      .set('Cookie', u.cookie)
      .send({ content: 'nothing here now' });
    expect(
      await db
        .select()
        .from(todos)
        .where(and(eq(todos.completed, true))),
    ).toHaveLength(1);
  });

  it('the note view shows an up-to-date todo count after a todo is deleted', async () => {
    const { app, ai } = setup();
    ai.respondWith(reply(item({ text: 'Buy milk', evidence: 'buy milk' })));
    const u = await createUserWithSession(db);
    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'T', content: 'buy milk' });
    expect(created.body.note.analysis.todos).toBe(1);
    const [t] = await db.select().from(todos);
    await request(app).delete(`/api/todos/${t?.id}`).set('Cookie', u.cookie);
    const note = await request(app)
      .get(`/api/notes/${created.body.note.id}`)
      .set('Cookie', u.cookie);
    expect(note.body.note.analysis.todos).toBe(0);
  });
});
