import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { aiDismissed, notes, reminderDrafts, reminders } from '../../db/schema.js';
import { nextOccurrence, normalizeDays } from '../../lib/recurrence.js';

export interface ReminderDraftDto {
  id: string;
  text: string;
  person: string | null;
  /** A date the note stated ("YYYY-MM-DD", the user's local calendar), offered as a prefill. */
  suggestedDate: string | null;
  /** Set for a repeating draft: only the time of day is missing. */
  recurrence: { days: number[] } | null;
  sourceNote: { id: string; title: string };
  createdAt: string;
}

export async function listDrafts(db: Db, userId: string): Promise<ReminderDraftDto[]> {
  const rows = await db
    .select({
      id: reminderDrafts.id,
      text: reminderDrafts.content,
      person: reminderDrafts.person,
      suggestedDate: reminderDrafts.suggestedDate,
      recurrenceDays: reminderDrafts.recurrenceDays,
      noteId: notes.id,
      noteTitle: notes.title,
      createdAt: reminderDrafts.createdAt,
    })
    .from(reminderDrafts)
    .innerJoin(
      notes,
      and(eq(notes.id, reminderDrafts.sourceNoteId), eq(notes.userId, reminderDrafts.userId)),
    )
    .where(eq(reminderDrafts.userId, userId))
    .orderBy(desc(reminderDrafts.createdAt), desc(reminderDrafts.id));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    person: r.person,
    suggestedDate: r.suggestedDate,
    recurrence: r.recurrenceDays ? { days: r.recurrenceDays } : null,
    sourceNote: { id: r.noteId, title: r.noteTitle },
    createdAt: r.createdAt.toISOString(),
  }));
}

export type CompleteResult =
  | { status: 'created'; reminderId: string }
  | { status: 'not_found' }
  /** The needed date/time was not supplied, or does not form a future instant. */
  | { status: 'invalid'; message: string };

/**
 * Turn a draft into a real reminder with the date and time the user supplied. All in one
 * transaction on the locked draft row, so a double submit creates one reminder, never two.
 * The reminder is marked user-modified (the user chose its time) so re-analysis cannot move it.
 */
export async function completeDraft(
  db: Db,
  userId: string,
  id: string,
  input: {
    /** UTC instant of the typed date + time, or null when it was not valid. */
    dueAt: Date | null;
    /** "HH:mm" typed by the user (the time of day a repeating draft needs). */
    time: string;
    text?: string;
    person?: string | null;
  },
  now: Date,
  timezone: string,
): Promise<CompleteResult> {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(reminderDrafts)
      .where(and(eq(reminderDrafts.id, id), eq(reminderDrafts.userId, userId)))
      .for('update');
    if (!draft) return { status: 'not_found' } as const;

    const days = normalizeDays(draft.recurrenceDays);
    const content = input.text ?? draft.content;
    const person = input.person === undefined ? draft.person : input.person;

    let dueAt: Date;
    let recurrenceTime: string | null = null;
    if (days) {
      // A repeating draft only lacks its time of day; the next occurrence is derived from it.
      dueAt = nextOccurrence({ days, time: input.time }, now, timezone);
      recurrenceTime = input.time;
    } else {
      if (!input.dueAt) {
        return { status: 'invalid', message: 'That is not a valid date and time.' } as const;
      }
      if (input.dueAt.getTime() <= now.getTime()) {
        return {
          status: 'invalid',
          message: 'That time has already passed. Choose a date and time in the future.',
        } as const;
      }
      dueAt = input.dueAt;
    }

    const [created] = await tx
      .insert(reminders)
      .values({
        userId,
        sourceNoteId: draft.sourceNoteId,
        content,
        aiText: draft.aiText ?? draft.content,
        person,
        dueAt,
        dueHasTime: true,
        recurrenceDays: days,
        recurrenceTime,
        createdByAi: true,
        aiFingerprint: draft.aiFingerprint,
        userModified: true,
      })
      .returning({ id: reminders.id });
    if (!created) throw new Error('reminder insert returned no row');
    await tx
      .delete(reminderDrafts)
      .where(and(eq(reminderDrafts.id, id), eq(reminderDrafts.userId, userId)));
    return { status: 'created', reminderId: created.id } as const;
  });
}

/** Dismiss a draft. A tombstone stops the same item from coming back when the note is re-analysed. */
export async function dismissDraft(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(reminderDrafts)
      .where(and(eq(reminderDrafts.id, id), eq(reminderDrafts.userId, userId)))
      .for('update');
    if (!draft) return false;
    await tx
      .insert(aiDismissed)
      .values({
        userId,
        sourceNoteId: draft.sourceNoteId,
        kind: 'reminder',
        aiFingerprint: draft.aiFingerprint,
        itemText: draft.aiText ?? draft.content,
        person: draft.person,
      })
      .onConflictDoNothing();
    await tx
      .delete(reminderDrafts)
      .where(and(eq(reminderDrafts.id, id), eq(reminderDrafts.userId, userId)));
    return true;
  });
}
