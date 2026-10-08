import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  aiDismissed,
  askHistory,
  askHistorySources,
  notes,
  reminders,
  sessions,
  todos,
  users,
} from '../../src/db/schema.js';
import { openTestDb, resetDb } from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

async function seedUser(email: string) {
  const [u] = await db
    .insert(users)
    .values({ googleSub: `sub-${email}`, email, name: email })
    .returning();
  if (!u) throw new Error('seed failed');
  return u;
}
async function seedNote(userId: string, title = 'A note') {
  const [n] = await db.insert(notes).values({ userId, title, content: 'content' }).returning();
  if (!n) throw new Error('seed failed');
  return n;
}

describe('migrations', () => {
  it('created every expected table in the test database', async () => {
    const res = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = res.rows.map((r) => r.table_name);
    for (const t of [
      'users',
      'sessions',
      'notes',
      'todos',
      'reminders',
      'ai_dismissed',
      'ask_history',
      'ask_history_sources',
    ]) {
      expect(names).toContain(t);
    }
    const applied = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from drizzle.__drizzle_migrations`,
    );
    expect(Number(applied.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('stores timestamps as timestamptz', async () => {
    const res = await db.execute<{ data_type: string }>(
      sql`select data_type from information_schema.columns
          where table_name = 'notes' and column_name = 'created_at'`,
    );
    expect(res.rows[0]?.data_type).toBe('timestamp with time zone');
  });
});

describe('schema behaviour', () => {
  it('applies defaults', async () => {
    const u = await seedUser('a@example.com');
    expect(u.timezone).toBe('UTC');
    const n = await seedNote(u.id);
    expect(n.analysisStatus).toBe('pending');
    const [t] = await db
      .insert(todos)
      .values({ userId: u.id, sourceNoteId: n.id, title: 'x' })
      .returning();
    expect(t).toMatchObject({
      completed: false,
      createdByAi: false,
      dueAt: null,
      dueHasTime: false,
    });
  });

  it('enforces unique google_sub', async () => {
    await seedUser('a@example.com');
    await expect(
      db.insert(users).values({ googleSub: 'sub-a@example.com', email: 'b@x.com', name: 'b' }),
    ).rejects.toThrow();
  });

  it('rejects a todo/reminder that points at another user’s note', async () => {
    const a = await seedUser('a@example.com');
    const b = await seedUser('b@example.com');
    const noteOfA = await seedNote(a.id);
    await expect(
      db.insert(todos).values({ userId: b.id, sourceNoteId: noteOfA.id, title: 'sneaky' }),
    ).rejects.toThrow();
    await expect(
      db.insert(reminders).values({ userId: b.id, sourceNoteId: noteOfA.id, content: 'sneaky' }),
    ).rejects.toThrow();
  });

  it('cascades note deletion to todos, reminders and tombstones', async () => {
    const u = await seedUser('a@example.com');
    const n = await seedNote(u.id);
    await db.insert(todos).values({ userId: u.id, sourceNoteId: n.id, title: 't' });
    await db.insert(reminders).values({ userId: u.id, sourceNoteId: n.id, content: 'r' });
    await db
      .insert(aiDismissed)
      .values({ userId: u.id, sourceNoteId: n.id, kind: 'todo', aiFingerprint: 'fp' });
    await db.delete(notes).where(eq(notes.id, n.id));
    expect(await db.select().from(todos)).toHaveLength(0);
    expect(await db.select().from(reminders)).toHaveLength(0);
    expect(await db.select().from(aiDismissed)).toHaveLength(0);
  });

  it('prevents duplicate AI fingerprints per note but allows many manual items', async () => {
    const u = await seedUser('a@example.com');
    const n = await seedNote(u.id);
    const base = { userId: u.id, sourceNoteId: n.id, createdByAi: true };
    await db.insert(todos).values({ ...base, title: 'a', aiFingerprint: 'fp1' });
    await expect(
      db.insert(todos).values({ ...base, title: 'a', aiFingerprint: 'fp1' }),
    ).rejects.toThrow();
    await db.insert(todos).values({ userId: u.id, sourceNoteId: n.id, title: 'm1' });
    await db.insert(todos).values({ userId: u.id, sourceNoteId: n.id, title: 'm2' });
    expect(await db.select().from(todos)).toHaveLength(3);
  });

  it('keeps ask history sources (with title snapshot) when the note is deleted', async () => {
    const u = await seedUser('a@example.com');
    const n = await seedNote(u.id, 'Groceries');
    const [h] = await db
      .insert(askHistory)
      .values({ userId: u.id, question: 'q', answer: 'a' })
      .returning();
    if (!h) throw new Error('seed failed');
    await db
      .insert(askHistorySources)
      .values({ askId: h.id, noteId: n.id, noteTitleSnapshot: 'Groceries', rank: 1 });
    await db.delete(notes).where(eq(notes.id, n.id));
    const [src] = await db.select().from(askHistorySources);
    expect(src).toMatchObject({ noteId: null, noteTitleSnapshot: 'Groceries' });
  });

  it('cascades user deletion to everything the user owns', async () => {
    const u = await seedUser('a@example.com');
    const n = await seedNote(u.id);
    await db.insert(todos).values({ userId: u.id, sourceNoteId: n.id, title: 't' });
    await db
      .insert(sessions)
      .values({ id: 'h', userId: u.id, expiresAt: new Date(Date.now() + 1000) });
    await db.insert(askHistory).values({ userId: u.id, question: 'q', answer: 'a' });
    await db.delete(users).where(eq(users.id, u.id));
    for (const t of [notes, todos, sessions, askHistory]) {
      expect(await db.select().from(t)).toHaveLength(0);
    }
  });
});
