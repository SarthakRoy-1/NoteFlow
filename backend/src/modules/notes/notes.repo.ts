import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { notes } from '../../db/schema.js';
import type { CreateNoteInput, UpdateNoteInput } from './notes.schemas.js';

type NoteRow = typeof notes.$inferSelect;

export interface NoteDto {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSummaryDto {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

const PREVIEW_LENGTH = 160;
const LIST_LIMIT = 500;

export const toNoteDto = (n: NoteRow): NoteDto => ({
  id: n.id,
  title: n.title,
  content: n.content,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
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

export async function getNote(db: Db, userId: string, id: string): Promise<NoteDto | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .limit(1);
  return row ? toNoteDto(row) : null;
}

export async function createNote(db: Db, userId: string, input: CreateNoteInput): Promise<NoteDto> {
  const [row] = await db
    .insert(notes)
    .values({ userId, title: input.title, content: input.content })
    .returning();
  if (!row) throw new Error('Note insert returned no row');
  return toNoteDto(row);
}

export async function updateNote(
  db: Db,
  userId: string,
  id: string,
  input: UpdateNoteInput,
): Promise<NoteDto | null> {
  const [row] = await db
    .update(notes)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content }),
      updatedAt: new Date(),
    })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning();
  return row ? toNoteDto(row) : null;
}

/** Returns true when a note owned by `userId` was deleted. */
export async function deleteNote(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning({ id: notes.id });
  return rows.length > 0;
}
