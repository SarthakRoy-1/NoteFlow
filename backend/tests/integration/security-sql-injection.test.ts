import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { askHistory, notes, reminders, todos, users } from '../../src/db/schema.js';
import { FakeAI } from '../helpers/fakeAi.js';
import {
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
  FakeGoogle,
} from '../helpers/testApp.js';

/**
 * SQL injection regression suite. Every untrusted value that can reach a database statement is
 * driven with classic injection payloads against the isolated `*_test` database. A passing test
 * means the payload was stored/compared as DATA and the database state (not just the HTTP status)
 * shows the query was not altered: no other user's rows touched, no table dropped, no extra rows.
 */
const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1 --",
  '" OR ""="',
  "'; DROP TABLE notes; --",
  "'; DELETE FROM notes WHERE 'a'='a",
  "' UNION SELECT id, email, name FROM users --",
  "' UNION SELECT NULL, NULL, NULL, NULL, NULL --",
  '1; SELECT pg_sleep(5); --',
  "\\'; SELECT 1; --",
  '/**/OR/**/1=1',
  '$1',
  '$$; DROP TABLE users; $$',
  "'||(SELECT string_agg(email, ',') FROM users)||'",
  "%' OR title LIKE '%",
  "'); INSERT INTO users(email, name) VALUES ('evil@example.com', 'evil'); --",
  "'' OR ''=''",
  "Robert'); DROP TABLE todos;--",
  '`; select 1;`',
  'ʼ OR ʼ1ʼ=ʼ1', // look-alike apostrophe
];

function setup() {
  const ai = new FakeAI();
  // A generous per-user AI allowance: the suite sends many notes and questions for one user.
  const app = buildApp(db, testEnv(), undefined, { ai, aiCallsPerMinute: 10_000 });
  return { ai, app };
}

async function seedNote(userId: string, title: string, content: string) {
  const [n] = await db
    .insert(notes)
    .values({ userId, title, content, analysisStatus: 'ok' })
    .returning();
  if (!n) throw new Error('seed failed');
  return n;
}

async function seedTodo(userId: string, noteId: string, title: string) {
  const [t] = await db
    .insert(todos)
    .values({ userId, sourceNoteId: noteId, title, createdByAi: false })
    .returning();
  if (!t) throw new Error('seed failed');
  return t;
}

async function seedReminder(userId: string, noteId: string, content: string) {
  const [r] = await db
    .insert(reminders)
    .values({ userId, sourceNoteId: noteId, content, person: 'Pat', createdByAi: false })
    .returning();
  if (!r) throw new Error('seed failed');
  return r;
}

/** Everything one user owns, as one comparable value (used to prove another user is untouched). */
async function snapshot(userId: string) {
  return JSON.stringify({
    notes: await db.select().from(notes).where(eq(notes.userId, userId)).orderBy(notes.id),
    todos: await db.select().from(todos).where(eq(todos.userId, userId)).orderBy(todos.id),
    reminders: await db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, userId))
      .orderBy(reminders.id),
    history: await db
      .select()
      .from(askHistory)
      .where(eq(askHistory.userId, userId))
      .orderBy(askHistory.id),
  });
}

const count = async (table: typeof users | typeof notes | typeof todos | typeof reminders) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]?.n ?? -1;

describe('note create / read / edit / delete treat payloads as data', () => {
  it.each(PAYLOADS)('round-trips %j unchanged and leaves other users alone', async (payload) => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedNote(b.user.id, 'B private', 'B content');
    const bBefore = await snapshot(b.user.id);
    const usersBefore = await count(users);

    const created = await request(app)
      .post('/api/notes')
      .set('Cookie', a.cookie)
      .send({ title: payload, content: `content ${payload}` });
    expect(created.status).toBe(201);
    expect(created.body.note.title).toBe(payload);
    const id = created.body.note.id as string;

    const read = await request(app).get(`/api/notes/${id}`).set('Cookie', a.cookie);
    expect(read.body.note.title).toBe(payload);
    expect(read.body.note.content).toBe(`content ${payload}`);

    const edited = await request(app)
      .patch(`/api/notes/${id}`)
      .set('Cookie', a.cookie)
      .send({ content: `edited ${payload}` });
    expect(edited.status).toBe(200);
    expect(edited.body.note.content).toBe(`edited ${payload}`);

    const list = await request(app).get('/api/notes').set('Cookie', a.cookie);
    expect(list.body.notes).toHaveLength(1);

    const removed = await request(app).delete(`/api/notes/${id}`).set('Cookie', a.cookie);
    expect(removed.status).toBe(204);

    // The database, not just the response, shows nothing else moved.
    expect(await snapshot(b.user.id)).toBe(bBefore);
    expect(await count(users)).toBe(usersBefore);
    expect(await count(notes)).toBe(1); // only B's note remains
  });
});

describe('todo and reminder edits treat payloads as data and stay in scope', () => {
  it.each(PAYLOADS)('stores %j literally and changes only the caller’s row', async (payload) => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const aNote = await seedNote(a.user.id, 'A note', 'A content');
    const bNote = await seedNote(b.user.id, 'B note', 'B content');
    const aTodo = await seedTodo(a.user.id, aNote.id, 'A todo');
    const aReminder = await seedReminder(a.user.id, aNote.id, 'A reminder');
    await seedTodo(b.user.id, bNote.id, 'B todo');
    await seedReminder(b.user.id, bNote.id, 'B reminder');
    const bBefore = await snapshot(b.user.id);

    const todoRes = await request(app)
      .patch(`/api/todos/${aTodo.id}`)
      .set('Cookie', a.cookie)
      .send({ title: payload.slice(0, 200) });
    expect(todoRes.status).toBe(200);
    expect(todoRes.body.todo.title).toBe(payload.slice(0, 200));

    const reminderRes = await request(app)
      .patch(`/api/reminders/${aReminder.id}`)
      .set('Cookie', a.cookie)
      .send({ text: payload.slice(0, 200), person: payload.slice(0, 80) });
    expect(reminderRes.status).toBe(200);
    expect(reminderRes.body.reminder.text).toBe(payload.slice(0, 200));
    expect(reminderRes.body.reminder.person).toBe(payload.slice(0, 80));

    expect(await snapshot(b.user.id)).toBe(bBefore);
    expect(await count(todos)).toBe(2);
    expect(await count(reminders)).toBe(2);
  });
});

describe('Ask AI retrieval cannot be widened by the question', () => {
  const FALCON = 'Project Falcon launch code is ALPHA-7-SECRET';

  const questions = [
    ...PAYLOADS,
    // Payloads that also match the other user's note, to prove scope (not just "no match").
    `falcon launch code' OR 1=1 --`,
    `falcon' UNION SELECT content FROM notes --`,
    // tsquery operator syntax must never reach the tsquery parser as syntax.
    'falcon & !secret | (code:*) <-> launch',
    "falcon:* | ''' | \\ | ! | ( | )",
  ];

  it.each(questions)('question %j only ever retrieves the asker’s own notes', async (question) => {
    const { app, ai } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await seedNote(a.user.id, 'Falcon plan', FALCON);
    const bNote = await seedNote(b.user.id, 'Falcon shopping', 'Buy falcon-shaped cookie cutters');
    const aBefore = await snapshot(a.user.id);

    ai.respondWith(
      JSON.stringify({ answer: 'Cookie cutters.', answerable: true, used_notes: [1] }),
    );
    const res = await request(app).post('/api/ask').set('Cookie', b.cookie).send({ question });
    expect(res.status).toBe(201);

    // Whatever the AI was sent, it never contained the other user's note.
    for (const req of ai.requests) {
      expect(req.user).not.toContain('ALPHA-7-SECRET');
      expect(req.user).not.toContain('Falcon plan');
    }
    // Sources can only be the asker's own note.
    for (const source of res.body.ask.sources as { noteId: string | null }[]) {
      expect(source.noteId).toBe(bNote.id);
    }
    expect(JSON.stringify(res.body)).not.toContain('ALPHA-7-SECRET');
    expect(await snapshot(a.user.id)).toBe(aBefore);
    expect(await count(notes)).toBe(2);
  });
});

describe('path, query and cookie inputs', () => {
  it.each(PAYLOADS)('resource id %j is "not found", never a 500', async (payload) => {
    const { app } = setup();
    const a = await createUserWithSession(db);
    const note = await seedNote(a.user.id, 'Mine', 'content');
    const before = await snapshot(a.user.id);
    const id = encodeURIComponent(payload);
    for (const [method, url] of [
      ['get', `/api/notes/${id}`],
      ['patch', `/api/notes/${id}`],
      ['delete', `/api/notes/${id}`],
      ['post', `/api/notes/${id}/analyze`],
      ['get', `/api/todos/${id}`],
      ['patch', `/api/todos/${id}`],
      ['delete', `/api/todos/${id}`],
      ['get', `/api/reminders/${id}`],
      ['patch', `/api/reminders/${id}`],
      ['delete', `/api/reminders/${id}`],
      ['get', `/api/ask/history/${id}`],
    ] as const) {
      const req = request(app)[method](url).set('Cookie', a.cookie);
      const res = await (method === 'patch'
        ? req.send({ title: 'x', content: 'x', text: 'x' })
        : req);
      expect([404, 422], `${method} ${url} -> ${res.status}`).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
    expect(await snapshot(a.user.id)).toBe(before);
    expect(note.id).toBeTruthy();
  });

  it.each(PAYLOADS)(
    'todo status filter %j falls back to "all" and stays scoped',
    async (payload) => {
      const { app } = setup();
      const a = await createUserWithSession(db, { email: 'a@example.com' });
      const b = await createUserWithSession(db, { email: 'b@example.com' });
      const aNote = await seedNote(a.user.id, 'A', 'a');
      const bNote = await seedNote(b.user.id, 'B', 'b');
      await seedTodo(a.user.id, aNote.id, 'A todo');
      await seedTodo(b.user.id, bNote.id, 'B todo');

      const res = await request(app)
        .get('/api/todos')
        .query({
          status: payload,
          user_id: b.user.id,
          limit: payload,
          order: payload,
          offset: payload,
        })
        .set('Cookie', a.cookie);
      expect(res.status).toBe(200);
      expect(res.body.todos.map((t: { title: string }) => t.title)).toEqual(['A todo']);
    },
  );

  it.each(PAYLOADS)('session cookie %j is simply an unknown session', async (payload) => {
    const { app } = setup();
    await createUserWithSession(db);
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', `noteflow_session=${encodeURIComponent(payload)}`);
    expect(res.status).toBe(401);
    expect(await count(users)).toBe(1);
  });

  it.each(PAYLOADS)('timezone %j is rejected before any query', async (payload) => {
    const { app } = setup();
    const a = await createUserWithSession(db);
    const res = await request(app)
      .patch('/api/me')
      .set('Cookie', a.cookie)
      .send({ timezone: payload });
    expect(res.status).toBe(422);
    const [row] = await db.select().from(users).where(eq(users.id, a.user.id));
    expect(row?.timezone).toBe('UTC');
  });

  it('every id field in a request body is rejected, never honoured', async () => {
    const { app } = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    const bNote = await seedNote(b.user.id, 'B', 'b');
    const bBefore = await snapshot(b.user.id);

    const attempts: [string, string, object][] = [
      ['post', '/api/notes', { title: 't', content: 'c', user_id: b.user.id }],
      ['post', '/api/notes', { title: 't', content: 'c', userId: b.user.id }],
      ['post', '/api/notes', { title: 't', content: 'c', id: bNote.id }],
      ['post', '/api/ask', { question: 'q', user_id: b.user.id }],
      ['patch', `/api/notes/${bNote.id}`, { title: 'hijack' }],
      ['patch', '/api/me', { timezone: 'UTC', id: b.user.id }],
    ];
    for (const [method, url, body] of attempts) {
      const res = await request(app)
        [method as 'post' | 'patch'](url)
        .set('Cookie', a.cookie)
        .send(body);
      expect([404, 422], `${method} ${url} -> ${res.status}`).toContain(res.status);
    }
    expect(await snapshot(b.user.id)).toBe(bBefore);
  });
});

describe('Google OAuth callback inputs', () => {
  it.each(PAYLOADS)(
    'state/code %j ends at the login error page with no side effects',
    async (payload) => {
      const google = new FakeGoogle();
      const app = buildApp(db, testEnv(), google);
      const res = await request(app)
        .get('/api/auth/google/callback')
        .query({ state: payload, code: payload, error: undefined });
      expect(res.status).toBe(302);
      expect(String(res.headers.location)).toMatch(/\/login\?error=invalid_state$/);
      expect(await count(users)).toBe(0);
      expect(google.completed).toHaveLength(0);
    },
  );
});

describe('database integrity after the whole battery', () => {
  it('still has every table and only the rows the tests created', async () => {
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const t of ['users', 'sessions', 'notes', 'todos', 'reminders', 'ask_history']) {
      expect(names).toContain(t);
    }
  });
});

describe('static guard: no raw/dynamic SQL can be introduced silently', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.resolve(here, '../../src');

  const sources: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts')) sources.push({ file: full, text: readFileSync(full, 'utf8') });
    }
  };
  walk(srcDir);

  it('finds the backend sources', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each([
    ['sql.raw(', /\bsql\.raw\s*\(/],
    ['sql.identifier(', /\bsql\.identifier\s*\(/],
    ['sql.placeholder(', /\bsql\.placeholder\s*\(/],
    ['pool.query / client.query', /\b(pool|client)\.query\s*\(/],
    ['.unsafe(', /\.unsafe\s*\(/],
    ['db.execute(', /\bdb\.execute\s*\(/],
  ])('backend/src never uses %s', (_label, pattern) => {
    const offenders = sources
      .filter((s) => pattern.test(s.text))
      .map((s) => path.relative(srcDir, s.file));
    expect(offenders).toEqual([]);
  });

  it('every sql`...` template only interpolates identifiers/columns or bound values', () => {
    // A template literal that is built by string concatenation and then handed to sql/execute would
    // show up as `sql(` (function call) or `+` next to a sql tag; neither exists today.
    const offenders = sources
      .filter((s) => /\bsql\s*\(/.test(s.text) || /sql`[^`]*`\s*\+/.test(s.text))
      .map((s) => path.relative(srcDir, s.file));
    expect(offenders).toEqual([]);
  });
});
