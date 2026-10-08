import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { notes, reminders, todos } from '../../db/schema.js';
import type { CreateNoteInput, UpdateNoteInput } from './notes.schemas.js';

type NoteRow = typeof notes.$inferSelect;

export interface AnalysisDto {
  status: 'pending' | 'ok' | 'failed';
  /** User-safe message when status is 'failed'. */
  error: string | null;
  /** How many todos / reminders currently derive from this note. */
  todos: number;
  reminders: number;
}

export interface NoteDto {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  analysis: AnalysisDto;
}

export interface NoteSummaryDto {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw row plus derived counts; used by the analysis service, which needs the exact updatedAt. */
export interface NoteWithCounts {
  row: NoteRow;
  todos: number;
  reminders: number;
}

const PREVIEW_LENGTH = 160;
const LIST_LIMIT = 500;

export const toNoteDto = ({ row, todos: t, reminders: r }: NoteWithCounts): NoteDto => ({
  id: row.id,
  title: row.title,
  content: row.content,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  analysis: {
    status: row.analysisStatus,
    error: row.analysisStatus === 'failed' ? row.analysisError : null,
    todos: t,
    reminders: r,
  },
});

// Every function below takes the session-derived userId and scopes its query by it.
// There is deliberately no function that reads or writes a note by id alone.

export async function listNotes(db: Db, userId: string): Promise<NoteSummaryDto[]> {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      preview: sql<string>`left(${notes.content}, ${PREVIEW_LENGTH})`,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .limit(LIST_LIMIT);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getNoteWithCounts(
  db: Db,
  userId: string,
  id: string,
): Promise<NoteWithCounts | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .limit(1);
  if (!row) return null;
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(todos)
    .where(and(eq(todos.sourceNoteId, id), eq(todos.userId, userId)));
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reminders)
    .where(and(eq(reminders.sourceNoteId, id), eq(reminders.userId, userId)));
  return { row, todos: t?.n ?? 0, reminders: r?.n ?? 0 };
}

export async function getNote(db: Db, userId: string, id: string): Promise<NoteDto | null> {
  const found = await getNoteWithCounts(db, userId, id);
  return found ? toNoteDto(found) : null;
}

/** New notes start as analysis 'pending'. Timestamps are set from JS so they have ms precision. */
export async function insertNote(db: Db, userId: string, input: CreateNoteInput): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(notes)
    .values({
      userId,
      title: input.title,
      content: input.content,
      analysisStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: notes.id });
  if (!row) throw new Error('Note insert returned no row');
  return row.id;
}

/** Applies an edit and marks the note's analysis stale ('pending'). Returns false if not owned. */
export async function applyNoteEdit(
  db: Db,
  userId: string,
  id: string,
  input: UpdateNoteInput,
): Promise<boolean> {
  const rows = await db
    .update(notes)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content }),
      analysisStatus: 'pending',
      analysisError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning({ id: notes.id });
  return rows.length > 0;
}

/** Returns true when a note owned by `userId` was deleted. */
export async function deleteNote(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning({ id: notes.id });
  return rows.length > 0;
}
