import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { aiDismissed, notes, todos } from '../../db/schema.js';
import type { ResolvedDue } from './todos.schemas.js';

export interface TodoDto {
  id: string;
  title: string;
  completed: boolean;
  completedAt: string | null;
  /** ISO instant (UTC) or null. When dueHasTime is false it is the end of the due day (user tz). */
  dueAt: string | null;
  dueHasTime: boolean;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  /** The note this todo came from (always present: deleting the note deletes its todos). */
  sourceNote: { id: string; title: string };
}

const LIST_LIMIT = 500;

const selection = {
  id: todos.id,
  title: todos.title,
  completed: todos.completed,
  completedAt: todos.completedAt,
  dueAt: todos.dueAt,
  dueHasTime: todos.dueHasTime,
  createdByAi: todos.createdByAi,
  createdAt: todos.createdAt,
  updatedAt: todos.updatedAt,
  noteId: notes.id,
  noteTitle: notes.title,
};

type Row = {
  id: string;
  title: string;
  completed: boolean;
  completedAt: Date | null;
  dueAt: Date | null;
  dueHasTime: boolean;
  createdByAi: boolean;
  createdAt: Date;
  updatedAt: Date;
  noteId: string;
  noteTitle: string;
};

const toDto = (r: Row): TodoDto => ({
  id: r.id,
  title: r.title,
  completed: r.completed,
  completedAt: r.completedAt?.toISOString() ?? null,
  dueAt: r.dueAt?.toISOString() ?? null,
  dueHasTime: r.dueHasTime,
  createdByAi: r.createdByAi,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  sourceNote: { id: r.noteId, title: r.noteTitle },
});

// Every function takes the session-derived userId. The note join is ownership-scoped too, so a
// todo can never expose a note title belonging to someone else.
const joinNote = and(eq(notes.id, todos.sourceNoteId), eq(notes.userId, todos.userId));

export async function listTodos(
  db: Db,
  userId: string,
  status: 'open' | 'done' | 'all',
): Promise<TodoDto[]> {
  const filters = [eq(todos.userId, userId)];
  if (status === 'open') filters.push(eq(todos.completed, false));
  if (status === 'done') filters.push(eq(todos.completed, true));
  const rows = await db
    .select(selection)
    .from(todos)
    .innerJoin(notes, joinNote)
    .where(and(...filters))
    .orderBy(
      asc(todos.completed), // open first
      sql`${todos.dueAt} asc nulls last`, // soonest due first, undated last
      desc(todos.createdAt),
      desc(todos.id),
    )
    .limit(LIST_LIMIT);
  return rows.map(toDto);
}

export async function getTodo(db: Db, userId: string, id: string): Promise<TodoDto | null> {
  const [row] = await db
    .select(selection)
    .from(todos)
    .innerJoin(notes, joinNote)
    .where(and(eq(todos.id, id), eq(todos.userId, userId)))
    .limit(1);
  return row ? toDto(row) : null;
}

export interface TodoChanges {
  title?: string;
  completed?: boolean;
  due?: ResolvedDue;
}

/**
 * Apply an edit. Editing the text or due date marks the todo `user_modified`, so a later
 * re-analysis of the note never overwrites or removes it. Toggling completion does not.
 * Returns false when no todo owned by `userId` matched.
 */
export async function updateTodo(
  db: Db,
  userId: string,
  id: string,
  changes: TodoChanges,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(todos)
    .set({
      ...(changes.title !== undefined && { title: changes.title, userModified: true }),
      ...(changes.due !== undefined && {
        dueAt: changes.due.dueAt,
        dueHasTime: changes.due.dueHasTime,
        userModified: true,
      }),
      ...(changes.completed !== undefined && {
        completed: changes.completed,
        completedAt: changes.completed ? now : null,
      }),
      updatedAt: now,
    })
    .where(and(eq(todos.id, id), eq(todos.userId, userId)))
    .returning({ id: todos.id });
  return rows.length > 0;
}

/**
 * Delete a todo owned by `userId`. AI-created todos leave a tombstone first, so re-analysing the
 * note does not bring back something the user removed. Returns false when nothing matched.
 */
export async function deleteTodo(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        sourceNoteId: todos.sourceNoteId,
        createdByAi: todos.createdByAi,
        aiFingerprint: todos.aiFingerprint,
      })
      .from(todos)
      .where(and(eq(todos.id, id), eq(todos.userId, userId)))
      .for('update');
    if (!row) return false;
    if (row.createdByAi && row.aiFingerprint) {
      await tx
        .insert(aiDismissed)
        .values({
          userId,
          sourceNoteId: row.sourceNoteId,
          kind: 'todo',
          aiFingerprint: row.aiFingerprint,
        })
        .onConflictDoNothing();
    }
    await tx.delete(todos).where(and(eq(todos.id, id), eq(todos.userId, userId)));
    return true;
  });
}
