import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { aiDismissed, notes, reminders } from '../../db/schema.js';
import type { ResolvedDue } from './reminders.schemas.js';

export interface ReminderDto {
  id: string;
  text: string;
  /** A person named in the note. Informational only: nobody is notified. */
  person: string | null;
  /** UTC instant, or null when the note gave no date/time (such a reminder never alerts). */
  dueAt: string | null;
  /** false = only a date was given; dueAt is then the start of that local day. */
  dueHasTime: boolean;
  status: 'pending' | 'acknowledged' | 'dismissed';
  /** When the user acknowledged the alert. */
  acknowledgedAt: string | null;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  /** The note this reminder came from (always present: deleting the note deletes its reminders). */
  sourceNote: { id: string; title: string };
}

const LIST_LIMIT = 500;
const DUE_LIMIT = 50;

const selection = {
  id: reminders.id,
  text: reminders.content,
  person: reminders.person,
  dueAt: reminders.dueAt,
  dueHasTime: reminders.dueHasTime,
  status: reminders.status,
  alertedAt: reminders.alertedAt,
  createdByAi: reminders.createdByAi,
  createdAt: reminders.createdAt,
  updatedAt: reminders.updatedAt,
  noteId: notes.id,
  noteTitle: notes.title,
};

type Row = {
  id: string;
  text: string;
  person: string | null;
  dueAt: Date | null;
  dueHasTime: boolean;
  status: 'pending' | 'acknowledged' | 'dismissed';
  alertedAt: Date | null;
  createdByAi: boolean;
  createdAt: Date;
  updatedAt: Date;
  noteId: string;
  noteTitle: string;
};

const toDto = (r: Row): ReminderDto => ({
  id: r.id,
  text: r.text,
  person: r.person,
  dueAt: r.dueAt?.toISOString() ?? null,
  dueHasTime: r.dueHasTime,
  status: r.status,
  acknowledgedAt: r.status === 'pending' ? null : (r.alertedAt?.toISOString() ?? null),
  createdByAi: r.createdByAi,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  sourceNote: { id: r.noteId, title: r.noteTitle },
});

// Every function takes the session-derived userId. The note join is ownership-scoped too, so a
// reminder can never expose a note title belonging to someone else.
const joinNote = and(eq(notes.id, reminders.sourceNoteId), eq(notes.userId, reminders.userId));

/** Active (pending) reminders first, soonest due first, undated last; handled ones afterwards. */
export async function listReminders(db: Db, userId: string): Promise<ReminderDto[]> {
  const rows = await db
    .select(selection)
    .from(reminders)
    .innerJoin(notes, joinNote)
    .where(eq(reminders.userId, userId))
    .orderBy(
      sql`(${reminders.status} <> 'pending') asc`,
      sql`${reminders.dueAt} asc nulls last`,
      desc(reminders.createdAt),
      desc(reminders.id),
    )
    .limit(LIST_LIMIT);
  return rows.map(toDto);
}

export async function getReminder(db: Db, userId: string, id: string): Promise<ReminderDto | null> {
  const [row] = await db
    .select(selection)
    .from(reminders)
    .innerJoin(notes, joinNote)
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
    .limit(1);
  return row ? toDto(row) : null;
}

/**
 * Reminders whose alert time has arrived: pending, with a due instant at or before `now`.
 * A reminder with no due date never alerts. `nextDueAt` is the next pending due instant in the
 * future, so the browser can wake up exactly then instead of only polling.
 */
export async function getDueReminders(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ reminders: ReminderDto[]; nextDueAt: string | null }> {
  const rows = await db
    .select(selection)
    .from(reminders)
    .innerJoin(notes, joinNote)
    .where(
      and(eq(reminders.userId, userId), eq(reminders.status, 'pending'), lte(reminders.dueAt, now)),
    )
    .orderBy(asc(reminders.dueAt), desc(reminders.id))
    .limit(DUE_LIMIT);
  const [next] = await db
    .select({ dueAt: reminders.dueAt })
    .from(reminders)
    .where(
      and(eq(reminders.userId, userId), eq(reminders.status, 'pending'), gt(reminders.dueAt, now)),
    )
    .orderBy(asc(reminders.dueAt))
    .limit(1);
  return { reminders: rows.map(toDto), nextDueAt: next?.dueAt?.toISOString() ?? null };
}

export interface ReminderChanges {
  text?: string;
  person?: string | null;
  due?: ResolvedDue;
  acknowledged?: boolean;
}

/**
 * Apply an edit. Editing text, person or due date marks the reminder `user_modified`, so a later
 * re-analysis never overwrites or removes it. A changed due date re-arms the alert (back to
 * pending). Returns false when no reminder owned by `userId` matched.
 */
export async function updateReminder(
  db: Db,
  userId: string,
  id: string,
  changes: ReminderChanges,
  now: Date,
): Promise<boolean> {
  const rearm = changes.due !== undefined && changes.acknowledged === undefined;
  const rows = await db
    .update(reminders)
    .set({
      ...(changes.text !== undefined && { content: changes.text, userModified: true }),
      ...(changes.person !== undefined && { person: changes.person, userModified: true }),
      ...(changes.due !== undefined && {
        dueAt: changes.due.dueAt,
        dueHasTime: changes.due.dueHasTime,
        userModified: true,
      }),
      ...(rearm && { status: 'pending' as const, alertedAt: null }),
      ...(changes.acknowledged === true && { status: 'acknowledged' as const, alertedAt: now }),
      ...(changes.acknowledged === false && { status: 'pending' as const, alertedAt: null }),
      updatedAt: now,
    })
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
    .returning({ id: reminders.id });
  return rows.length > 0;
}

/**
 * Delete a reminder owned by `userId`. AI-created reminders leave a tombstone first, so
 * re-analysing the note does not bring back something the user removed.
 */
export async function deleteReminder(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        sourceNoteId: reminders.sourceNoteId,
        createdByAi: reminders.createdByAi,
        aiFingerprint: reminders.aiFingerprint,
      })
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .for('update');
    if (!row) return false;
    if (row.createdByAi && row.aiFingerprint) {
      await tx
        .insert(aiDismissed)
        .values({
          userId,
          sourceNoteId: row.sourceNoteId,
          kind: 'reminder',
          aiFingerprint: row.aiFingerprint,
        })
        .onConflictDoNothing();
    }
    await tx.delete(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, userId)));
    return true;
  });
}
