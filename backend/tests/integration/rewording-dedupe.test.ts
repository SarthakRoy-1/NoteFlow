import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AIProviderError } from '../../src/ai/provider/index.js';
import { aiDismissed, notes, reminders, todos } from '../../src/db/schema.js';
import { fingerprintItems } from '../../src/reconcile/fingerprint.js';
import { FakeAI, item, reply } from '../helpers/fakeAi.js';
import {
  buildApp,
  createUserWithSession,
  openTestDb,
  resetDb,
  testEnv,
} from '../helpers/testApp.js';

/**
 * Should-have 2 ("no duplicates"), including the case the model REWORDS an action after the user
 * edited, completed or deleted the item: the reworded copy must not appear as a second item, while
 * a genuinely different action must still be created.
 */
const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

function setup() {
  const ai = new FakeAI();
  const app = buildApp(db, testEnv(), undefined, { ai, aiCallsPerMinute: 1000 });
  return { ai, app };
}
type Ctx = ReturnType<typeof setup>;

const todo = (text: string, evidence: string) => item({ kind: 'todo', text, evidence });
const reminderItem = (text: string, evidence: string, person: string | null = null) =>
  item({ kind: 'reminder', text, evidence, person });

async function createNote(
  ctx: Ctx,
  cookie: string,
  content: string,
  ...items: ReturnType<typeof item>[]
) {
  ctx.ai.respondWith(reply(...items));
  const res = await request(ctx.app)
    .post('/api/notes')
    .set('Cookie', cookie)
    .send({ title: 'Note', content });
  expect(res.status).toBe(201);
  expect(res.body.note.analysis.status).toBe('ok');
  return res.body.note.id as string;
}

async function editNote(
  ctx: Ctx,
  cookie: string,
  noteId: string,
  content: string,
  ...items: ReturnType<typeof item>[]
) {
  ctx.ai.respondWith(reply(...items));
  const res = await request(ctx.app)
    .patch(`/api/notes/${noteId}`)
    .set('Cookie', cookie)
    .send({ content });
  expect(res.status).toBe(200);
  expect(res.body.note.analysis.status).toBe('ok');
}

const todoTitles = async () => (await db.select().from(todos)).map((t) => t.title).sort();
const reminderTexts = async () => (await db.select().from(reminders)).map((r) => r.content).sort();

describe('the user edited an AI todo, then the model rewords it', () => {
  it('does not add a second todo (the edge case from the previous audit)', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Buy milk tomorrow',
      todo('Buy milk', 'buy milk'),
    );
    const [created] = await db.select().from(todos);
    expect(created?.aiText).toBe('Buy milk');

    await request(ctx.app)
      .patch(`/api/todos/${created?.id}`)
      .set('Cookie', u.cookie)
      .send({ title: 'Buy oat milk' });

    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Buy milk tomorrow. Call mum.',
      todo('Buy some milk', 'buy milk'), // reworded by the model
      todo('Call mum', 'call mum'),
    );
    expect(await todoTitles()).toEqual(['Buy oat milk', 'Call mum']);
  });

  it('keeps the user’s text when the model returns the original wording again', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Buy milk tomorrow',
      todo('Buy milk', 'buy milk'),
    );
    const [created] = await db.select().from(todos);
    await request(ctx.app)
      .patch(`/api/todos/${created?.id}`)
      .set('Cookie', u.cookie)
      .send({ title: 'Buy oat milk' });
    await editNote(ctx, u.cookie, noteId, 'Buy milk tomorrow!', todo('Buy milk', 'buy milk'));
    expect(await todoTitles()).toEqual(['Buy oat milk']);
  });
});

describe('the user completed an AI todo, then the model rewords it', () => {
  it('does not bring back an open copy', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Buy milk tomorrow',
      todo('Buy milk', 'buy milk'),
    );
    const [created] = await db.select().from(todos);
    await request(ctx.app)
      .patch(`/api/todos/${created?.id}`)
      .set('Cookie', u.cookie)
      .send({ completed: true });

    await editNote(ctx, u.cookie, noteId, 'Buy milk tomorrow!!', todo('Buy some milk', 'buy milk'));
    const rows = await db.select().from(todos);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Buy milk', completed: true });
  });
});

describe('the user deleted an AI item, then the model rewords it', () => {
  it('does not resurrect a deleted todo', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Send the invoice to the client',
      todo('Send the invoice', 'send the invoice'),
    );
    const [created] = await db.select().from(todos);
    await request(ctx.app).delete(`/api/todos/${created?.id}`).set('Cookie', u.cookie);
    const [tomb] = await db.select().from(aiDismissed);
    expect(tomb?.itemText).toBe('Send the invoice');

    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Send the invoice to the client today',
      todo('Send invoice', 'send the invoice'), // reworded
    );
    expect(await todoTitles()).toEqual([]);
  });

  it('documented limit: a rewording that adds a detail is a new task, never merged', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Send the invoice to the client',
      todo('Send the invoice', 'send the invoice'),
    );
    const [created] = await db.select().from(todos);
    await request(ctx.app).delete(`/api/todos/${created?.id}`).set('Cookie', u.cookie);
    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Send the invoice to the client today',
      todo('Send invoice to client', 'send the invoice'),
    );
    // Conservative on purpose: a missed match leaves one deletable extra item; a wrong match would
    // hide a real task.
    expect(await todoTitles()).toEqual(['Send invoice to client']);
  });

  it('does not resurrect a deleted reminder that the user had edited, when it is reworded', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Remind John to send the invoice',
      reminderItem('Send the invoice', 'remind john to send the invoice', 'John'),
    );
    const [created] = await db.select().from(reminders);
    await request(ctx.app)
      .patch(`/api/reminders/${created?.id}`)
      .set('Cookie', u.cookie)
      .send({ text: 'Chase the invoice' });
    await request(ctx.app).delete(`/api/reminders/${created?.id}`).set('Cookie', u.cookie);

    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Remind John to send the invoice soon',
      reminderItem('Send invoice', 'remind john to send the invoice', 'John'),
    );
    expect(await reminderTexts()).toEqual([]);
  });

  it('still brings back nothing when the exact same item returns (existing guarantee)', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(ctx, u.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    const [created] = await db.select().from(todos);
    await request(ctx.app).delete(`/api/todos/${created?.id}`).set('Cookie', u.cookie);
    await editNote(ctx, u.cookie, noteId, 'Buy milk now', todo('Buy milk', 'buy milk'));
    expect(await todoTitles()).toEqual([]);
  });
});

describe('genuinely different actions are never merged', () => {
  it('creates a new todo for a different task next to an edited one', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(ctx, u.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    const [created] = await db.select().from(todos);
    await request(ctx.app)
      .patch(`/api/todos/${created?.id}`)
      .set('Cookie', u.cookie)
      .send({ title: 'Buy oat milk' });
    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Buy milk and buy eggs',
      todo('Buy milk', 'buy milk'),
      todo('Buy eggs', 'buy eggs'),
    );
    expect(await todoTitles()).toEqual(['Buy eggs', 'Buy oat milk']);
  });

  it('keeps a completed task and creates the similar-looking different one', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Email Sarah the report',
      todo('Email Sarah the report', 'email sarah the report'),
    );
    const [created] = await db.select().from(todos);
    await request(ctx.app)
      .patch(`/api/todos/${created?.id}`)
      .set('Cookie', u.cookie)
      .send({ completed: true });

    // The user replaced the sentence: it is now a different task, not a rewording.
    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Email Sarah the budget',
      todo('Email Sarah the budget', 'email sarah the budget'),
    );
    const rows = await db.select().from(todos);
    expect(rows.map((t) => [t.title, t.completed]).sort()).toEqual([
      ['Email Sarah the budget', false],
      ['Email Sarah the report', true],
    ]);
  });

  it('does not fold a different task into a deleted one', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(ctx, u.cookie, 'Call John', todo('Call John', 'call john'));
    const [created] = await db.select().from(todos);
    await request(ctx.app).delete(`/api/todos/${created?.id}`).set('Cookie', u.cookie);
    await editNote(ctx, u.cookie, noteId, 'Call Jane', todo('Call Jane', 'call jane'));
    expect(await todoTitles()).toEqual(['Call Jane']);
  });

  it('keeps reminders for different people apart even with identical wording', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Remind John to send the invoice',
      reminderItem('Send the invoice', 'remind john to send the invoice', 'John'),
    );
    const [created] = await db.select().from(reminders);
    await request(ctx.app)
      .patch(`/api/reminders/${created?.id}`)
      .set('Cookie', u.cookie)
      .send({ text: 'Chase the invoice' });
    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Remind John to send the invoice. Remind Mary to send the invoice.',
      reminderItem('Send invoice', 'remind john to send the invoice', 'John'),
      reminderItem('Send the invoice', 'remind mary to send the invoice', 'Mary'),
    );
    const rows = await db.select().from(reminders);
    expect(rows.map((r) => [r.content, r.person]).sort()).toEqual([
      ['Chase the invoice', 'John'],
      ['Send the invoice', 'Mary'],
    ]);
  });

  it('lets two items with the same text in one note stay two items', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    await createNote(
      ctx,
      u.cookie,
      'Call John at 5pm. Call John at 6pm.',
      todo('Call John', 'call john at 5pm'),
      todo('Call John', 'call john at 6pm'),
    );
    expect(await todoTitles()).toEqual(['Call John', 'Call John']);
  });

  it('does not merge the same text across two different notes', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    await createNote(ctx, u.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    await createNote(ctx, u.cookie, 'Buy milk too', todo('Buy milk', 'buy milk'));
    expect(await todoTitles()).toEqual(['Buy milk', 'Buy milk']);
  });
});

describe('plain re-saves, retries and concurrency', () => {
  it('an unchanged re-save calls no AI and adds nothing', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(ctx, u.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    const calls = ctx.ai.requests.length;
    for (let i = 0; i < 3; i++) {
      const res = await request(ctx.app)
        .patch(`/api/notes/${noteId}`)
        .set('Cookie', u.cookie)
        .send({ content: 'Buy milk' });
      expect(res.status).toBe(200);
    }
    expect(ctx.ai.requests.length).toBe(calls);
    expect(await todoTitles()).toEqual(['Buy milk']);
  });

  it('an edit that keeps the task changes the due date in place', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(
      ctx,
      u.cookie,
      'Buy milk tomorrow',
      item({
        kind: 'todo',
        text: 'Buy milk',
        evidence: 'buy milk tomorrow',
        due_kind: 'date',
        due_expression: 'tomorrow',
        due_local: '2026-10-09',
      }),
    );
    await editNote(
      ctx,
      u.cookie,
      noteId,
      'Buy milk on Friday',
      item({
        kind: 'todo',
        text: 'Buy milk',
        evidence: 'buy milk on friday',
        due_kind: 'date',
        due_expression: 'Friday',
        due_local: '2026-10-09',
      }),
    );
    expect(await todoTitles()).toEqual(['Buy milk']);
  });

  it('a retry after an AI failure creates the item once, and later edits do not duplicate it', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    ctx.ai.respondWith(new AIProviderError('unavailable', 'down'));
    const created = await request(ctx.app)
      .post('/api/notes')
      .set('Cookie', u.cookie)
      .send({ title: 'Note', content: 'Buy milk' });
    expect(created.body.note.analysis.status).toBe('failed');
    const noteId = created.body.note.id as string;

    ctx.ai.respondWith(reply(todo('Buy milk', 'buy milk')));
    const retried = await request(ctx.app)
      .post(`/api/notes/${noteId}/analyze`)
      .set('Cookie', u.cookie);
    expect(retried.body.note.analysis.status).toBe('ok');
    expect(await todoTitles()).toEqual(['Buy milk']);

    await editNote(ctx, u.cookie, noteId, 'Buy milk!', todo('Buy milk', 'buy milk'));
    expect(await todoTitles()).toEqual(['Buy milk']);
  });

  it('concurrent saves of one note leave exactly one todo', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(ctx, u.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    const same = reply(todo('Buy milk', 'buy milk'));
    ctx.ai.respondWith(same, same, same);
    const results = await Promise.all(
      ['Buy milk A', 'Buy milk B', 'Buy milk C'].map((content) =>
        request(ctx.app).patch(`/api/notes/${noteId}`).set('Cookie', u.cookie).send({ content }),
      ),
    );
    for (const r of results) expect(r.status).toBe(200);
    expect(await todoTitles()).toEqual(['Buy milk']);
  });
});

describe('older rows (created before the original wording was recorded)', () => {
  it('still match exactly, and fall back to the visible text for a reworded copy', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(ctx, u.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    // Make the row look like one written by the previous version.
    await db
      .update(todos)
      .set({ aiText: null, completed: true, completedAt: new Date() })
      .where(eq(todos.sourceNoteId, noteId));

    await editNote(ctx, u.cookie, noteId, 'Buy milk please', todo('Buy some milk', 'buy milk'));
    expect(await todoTitles()).toEqual(['Buy milk']);
  });

  it('an older tombstone (no text) still suppresses the exact item but cannot recognise a rewording', async () => {
    const ctx = setup();
    const u = await createUserWithSession(db);
    const noteId = await createNote(ctx, u.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    const [t] = await db.select().from(todos);
    await request(ctx.app).delete(`/api/todos/${t?.id}`).set('Cookie', u.cookie);
    await db
      .update(aiDismissed)
      .set({ itemText: null, person: null })
      .where(eq(aiDismissed.sourceNoteId, noteId));

    // Exact fingerprint: still suppressed.
    await editNote(ctx, u.cookie, noteId, 'Buy milk now', todo('Buy milk', 'buy milk'));
    expect(await todoTitles()).toEqual([]);
    // A rewording of a legacy tombstone cannot be recognised (documented limit): it is created.
    await editNote(ctx, u.cookie, noteId, 'Buy milk later', todo('Buy some milk', 'buy milk'));
    expect(await todoTitles()).toEqual(['Buy some milk']);
  });
});

describe('fingerprints themselves are unchanged (existing rows keep matching)', () => {
  it('is stable for a known value', () => {
    const [fp] = fingerprintItems([
      {
        kind: 'todo',
        text: 'Buy milk',
        person: null,
        evidence: 'buy milk',
        dueAt: null,
        dueHasTime: false,
        recurrenceDays: null,
        recurrenceTime: null,
      },
    ]);
    // sha256("todo|buy milk|#0"): pinned so rows written by earlier versions keep matching.
    expect(fp?.fingerprint).toBe(
      'f4203f82b4b7ff21eb2a5f8404466de8ea1bc2d97d2c40e387a2c895801b9692',
    );
  });

  it('does not touch rows of another user', async () => {
    const ctx = setup();
    const a = await createUserWithSession(db, { email: 'a@example.com' });
    const b = await createUserWithSession(db, { email: 'b@example.com' });
    await createNote(ctx, a.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    const noteB = await createNote(ctx, b.cookie, 'Buy milk', todo('Buy milk', 'buy milk'));
    await editNote(ctx, b.cookie, noteB, 'Buy milk!', todo('Buy some milk', 'buy milk'));
    const rowsA = await db
      .select()
      .from(notes)
      .where(and(eq(notes.userId, a.user.id)));
    expect(rowsA).toHaveLength(1);
    expect(await db.select().from(todos).where(eq(todos.userId, a.user.id))).toHaveLength(1);
  });
});
