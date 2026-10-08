import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notes } from '../../src/db/schema.js';
import { CONTENT_MAX, TITLE_MAX } from '../../src/modules/notes/notes.schemas.js';
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

const valid = { title: 'Groceries', content: 'buy milk tomorrow' };
const NIL_UUID = '00000000-0000-4000-8000-000000000000';

async function twoUsers() {
  const a = await createUserWithSession(db, { email: 'a@example.com' });
  const b = await createUserWithSession(db, { email: 'b@example.com' });
  return { a, b };
}

async function createFor(cookie: string, body = valid) {
  const res = await request(app).post('/api/notes').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.note as { id: string; title: string; content: string };
}

describe('authentication required', () => {
  it('rejects list, create, get, update and delete without a session', async () => {
    const { a } = await twoUsers();
    const note = await createFor(a.cookie);
    const url = `/api/notes/${note.id}`;
    const results = await Promise.all([
      request(app).get('/api/notes'),
      request(app).post('/api/notes').send(valid),
      request(app).get(url),
      request(app).patch(url).send({ title: 'x' }),
      request(app).delete(url),
    ]);
    for (const res of results) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    // and nothing changed
    const [row] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(row?.title).toBe(valid.title);
  });

  it('rejects an expired or invalid session on notes routes', async () => {
    const expired = await createUserWithSession(db, { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).get('/api/notes').set('Cookie', expired.cookie)).status).toBe(401);
    expect(
      (await request(app).get('/api/notes').set('Cookie', 'noteflow_session=nope')).status,
    ).toBe(401);
  });
});

describe('create', () => {
  it('creates a note owned by the session user and returns 201', async () => {
    const { a } = await twoUsers();
    const res = await request(app).post('/api/notes').set('Cookie', a.cookie).send(valid);
    expect(res.status).toBe(201);
    expect(res.body.note).toMatchObject(valid);
    expect(res.body.note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(res.body.note.createdAt)).not.toBeNaN();
    expect(JSON.stringify(res.body)).not.toContain('userId');
    const [row] = await db.select().from(notes).where(eq(notes.id, res.body.note.id));
    expect(row?.userId).toBe(a.user.id);
  });

  it('trims title and content', async () => {
    const { a } = await twoUsers();
    const note = await createFor(a.cookie, { title: '  Hello  ', content: '\n  body text \n' });
    expect(note).toMatchObject({ title: 'Hello', content: 'body text' });
  });

  it('stores text verbatim (no HTML interpretation or mangling)', async () => {
    const { a } = await twoUsers();
    const content = "<script>alert(1)</script> '; drop table notes; -- Ünïcödé 😀";
    const note = await createFor(a.cookie, { title: 'Tricky', content });
    const got = await request(app).get(`/api/notes/${note.id}`).set('Cookie', a.cookie);
    expect(got.body.note.content).toBe(content);
  });

  it('cannot be assigned to another user via user_id (any casing)', async () => {
    const { a, b } = await twoUsers();
    for (const key of ['user_id', 'userId', 'owner']) {
      const res = await request(app)
        .post('/api/notes')
        .set('Cookie', a.cookie)
        .send({ ...valid, [key]: b.user.id });
      expect(res.status).toBe(422);
    }
    expect(await db.select().from(notes)).toHaveLength(0);
    expect((await request(app).get('/api/notes').set('Cookie', b.cookie)).body.notes).toEqual([]);
  });

  it.each([
    ['empty content', { title: 'T', content: '' }],
    ['whitespace-only content', { title: 'T', content: '  \n\t ' }],
    ['missing content', { title: 'T' }],
    ['empty title', { title: '', content: 'x' }],
    ['whitespace-only title', { title: '   ', content: 'x' }],
    ['missing title', { content: 'x' }],
    ['non-string title', { title: 5, content: 'x' }],
    ['non-string content', { title: 'T', content: { a: 1 } }],
    ['null content', { title: 'T', content: null }],
    ['too-long title', { title: 'a'.repeat(TITLE_MAX + 1), content: 'x' }],
    ['too-long content', { title: 'T', content: 'a'.repeat(CONTENT_MAX + 1) }],
    ['unknown field', { title: 'T', content: 'x', extra: true }],
  ])('rejects %s with 422 and stores nothing', async (_name, body) => {
    const { a } = await twoUsers();
    const res = await request(app).post('/api/notes').set('Cookie', a.cookie).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await db.select().from(notes)).toHaveLength(0);
  });

  it('accepts the maximum allowed lengths', async () => {
    const { a } = await twoUsers();
    await createFor(a.cookie, {
      title: 'a'.repeat(TITLE_MAX),
      content: 'b'.repeat(CONTENT_MAX),
    });
  });

  it('rejects a body that is not JSON object', async () => {
    const { a } = await twoUsers();
    const res = await request(app)
      .post('/api/notes')
      .set('Cookie', a.cookie)
      .set('Content-Type', 'application/json')
      .send('[1,2]');
    expect(res.status).toBe(422);
  });
});

describe('list', () => {
  it('returns only the caller’s notes, newest-updated first, with previews', async () => {
    const { a, b } = await twoUsers();
    const first = await createFor(a.cookie, { title: 'first', content: 'x'.repeat(500) });
    const second = await createFor(a.cookie, { title: 'second', content: 'short' });
    await createFor(b.cookie, { title: 'secret of b', content: 'b only' });

    const res = await request(app).get('/api/notes').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    const titles = res.body.notes.map((n: { title: string }) => n.title);
    expect(titles).toEqual(['second', 'first']);
    expect(JSON.stringify(res.body)).not.toContain('secret of b');
    const firstItem = res.body.notes.find((n: { id: string }) => n.id === first.id);
    expect(firstItem.preview).toHaveLength(160);
    expect(firstItem.content).toBeUndefined();
    expect(second.id).toBeDefined();
  });

  it('ignores a user_id query parameter', async () => {
    const { a, b } = await twoUsers();
    await createFor(b.cookie, { title: 'b note', content: 'b' });
    const res = await request(app).get(`/api/notes?user_id=${b.user.id}`).set('Cookie', a.cookie);
    expect(res.body.notes).toEqual([]);
  });

  it('returns an empty list for a new user', async () => {
    const { a } = await twoUsers();
    const res = await request(app).get('/api/notes').set('Cookie', a.cookie);
    expect(res.body).toEqual({ notes: [] });
  });
});

describe('get one', () => {
  it('returns the full note to its owner', async () => {
    const { a } = await twoUsers();
    const note = await createFor(a.cookie);
    const res = await request(app).get(`/api/notes/${note.id}`).set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.note).toMatchObject({ id: note.id, ...valid });
  });

  it('returns 404 (not 403) for another user’s note, revealing nothing', async () => {
    const { a, b } = await twoUsers();
    const note = await createFor(a.cookie, { title: 'private title', content: 'private body' });
    const res = await request(app).get(`/api/notes/${note.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/private/);
  });

  it('returns 404 for unknown and malformed ids', async () => {
    const { a } = await twoUsers();
    for (const id of [NIL_UUID, 'not-a-uuid', '1', "' or 1=1 --"]) {
      const res = await request(app)
        .get(`/api/notes/${encodeURIComponent(id)}`)
        .set('Cookie', a.cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('update', () => {
  it('updates title and content and moves updated_at forward', async () => {
    const { a } = await twoUsers();
    const created = await request(app).post('/api/notes').set('Cookie', a.cookie).send(valid);
    const id = created.body.note.id as string;
    await new Promise((r) => setTimeout(r, 20));

    const res = await request(app)
      .patch(`/api/notes/${id}`)
      .set('Cookie', a.cookie)
      .send({ title: 'New title', content: 'new body' });
    expect(res.status).toBe(200);
    expect(res.body.note).toMatchObject({ id, title: 'New title', content: 'new body' });
    expect(Date.parse(res.body.note.updatedAt)).toBeGreaterThan(
      Date.parse(created.body.note.updatedAt),
    );
    expect(res.body.note.createdAt).toBe(created.body.note.createdAt);

    const [row] = await db.select().from(notes).where(eq(notes.id, id));
    expect(row).toMatchObject({ title: 'New title', content: 'new body', userId: a.user.id });
  });

  it('supports updating only one field', async () => {
    const { a } = await twoUsers();
    const note = await createFor(a.cookie);
    const res = await request(app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', a.cookie)
      .send({ content: 'only content changed' });
    expect(res.body.note).toMatchObject({ title: valid.title, content: 'only content changed' });
  });

  it('puts an edited note at the top of the list', async () => {
    const { a } = await twoUsers();
    const older = await createFor(a.cookie, { title: 'older', content: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    await createFor(a.cookie, { title: 'newer', content: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    await request(app)
      .patch(`/api/notes/${older.id}`)
      .set('Cookie', a.cookie)
      .send({ title: 'older!' });
    const list = await request(app).get('/api/notes').set('Cookie', a.cookie);
    expect(list.body.notes[0].title).toBe('older!');
  });

  it('cannot update another user’s note, and the note is left untouched', async () => {
    const { a, b } = await twoUsers();
    const note = await createFor(a.cookie);
    const res = await request(app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', b.cookie)
      .send({ title: 'hijacked', content: 'hijacked' });
    expect(res.status).toBe(404);
    const [row] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(row).toMatchObject({ ...valid, userId: a.user.id });
  });

  it('cannot reassign ownership or change id/timestamps through the body', async () => {
    const { a, b } = await twoUsers();
    const note = await createFor(a.cookie);
    for (const extra of [
      { user_id: b.user.id },
      { userId: b.user.id },
      { id: NIL_UUID },
      { createdAt: '2000-01-01' },
    ]) {
      const res = await request(app)
        .patch(`/api/notes/${note.id}`)
        .set('Cookie', a.cookie)
        .send({ title: 'ok', ...extra });
      expect(res.status).toBe(422);
    }
    const [row] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(row).toMatchObject({ userId: a.user.id, id: note.id, title: valid.title });
  });

  it.each([
    ['empty body', {}],
    ['blank title', { title: '  ' }],
    ['blank content', { content: '' }],
    ['too long', { title: 'a'.repeat(TITLE_MAX + 1) }],
    ['wrong type', { content: 42 }],
  ])('rejects %s with 422 and changes nothing', async (_name, body) => {
    const { a } = await twoUsers();
    const note = await createFor(a.cookie);
    const res = await request(app)
      .patch(`/api/notes/${note.id}`)
      .set('Cookie', a.cookie)
      .send(body);
    expect(res.status).toBe(422);
    const [row] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(row).toMatchObject(valid);
  });

  it('returns 404 for a missing or malformed id', async () => {
    const { a } = await twoUsers();
    for (const id of [NIL_UUID, 'garbage']) {
      const res = await request(app)
        .patch(`/api/notes/${id}`)
        .set('Cookie', a.cookie)
        .send({ title: 'x' });
      expect(res.status).toBe(404);
    }
  });
});

describe('delete', () => {
  it('deletes the owner’s note (204) and it is gone', async () => {
    const { a } = await twoUsers();
    const note = await createFor(a.cookie);
    const res = await request(app).delete(`/api/notes/${note.id}`).set('Cookie', a.cookie);
    expect(res.status).toBe(204);
    expect(await db.select().from(notes)).toHaveLength(0);
    expect((await request(app).get(`/api/notes/${note.id}`).set('Cookie', a.cookie)).status).toBe(
      404,
    );
    // deleting again is a 404, not a crash
    expect(
      (await request(app).delete(`/api/notes/${note.id}`).set('Cookie', a.cookie)).status,
    ).toBe(404);
  });

  it('cannot delete another user’s note; only the caller’s own data is affected', async () => {
    const { a, b } = await twoUsers();
    const noteA = await createFor(a.cookie, { title: 'A', content: 'a' });
    const noteB = await createFor(b.cookie, { title: 'B', content: 'b' });
    const res = await request(app).delete(`/api/notes/${noteA.id}`).set('Cookie', b.cookie);
    expect(res.status).toBe(404);
    const remaining = await db.select().from(notes);
    expect(remaining.map((n) => n.id).sort()).toEqual([noteA.id, noteB.id].sort());
  });

  it('returns 404 for a malformed id', async () => {
    const { a } = await twoUsers();
    expect((await request(app).delete('/api/notes/xyz').set('Cookie', a.cookie)).status).toBe(404);
  });
});

describe('persistence and origin protection', () => {
  it('notes survive a new app instance (data lives in PostgreSQL, not memory)', async () => {
    const { a } = await twoUsers();
    const note = await createFor(a.cookie);
    const freshApp = buildApp(db, testEnv());
    const res = await request(freshApp).get(`/api/notes/${note.id}`).set('Cookie', a.cookie);
    expect(res.body.note.title).toBe(valid.title);
  });

  it('blocks cross-origin writes to notes', async () => {
    const { a } = await twoUsers();
    const res = await request(app)
      .post('/api/notes')
      .set('Cookie', a.cookie)
      .set('Origin', 'https://evil.example')
      .send(valid);
    expect(res.status).toBe(403);
    expect(await db.select().from(notes)).toHaveLength(0);
  });

  it('deleting a user’s session does not delete their notes, and others cannot see them', async () => {
    const { a, b } = await twoUsers();
    const note = await createFor(a.cookie);
    await request(app).post('/api/auth/logout').set('Cookie', a.cookie);
    expect((await request(app).get('/api/notes').set('Cookie', a.cookie)).status).toBe(401);
    expect((await request(app).get(`/api/notes/${note.id}`).set('Cookie', b.cookie)).status).toBe(
      404,
    );
    expect(await db.select().from(notes)).toHaveLength(1);
  });
});
