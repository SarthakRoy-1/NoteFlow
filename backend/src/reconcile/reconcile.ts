import { and, eq, inArray } from 'drizzle-orm';
import type { ExtractedItem } from '../ai/extraction/validate.js';
import type { Db } from '../db/client.js';
import { aiDismissed, notes, reminders, todos } from '../db/schema.js';
import { fingerprintItems } from './fingerprint.js';

export type ReconcileOutcome =
  | { status: 'applied'; created: number; updated: number; removed: number }
  /** The note changed while the AI was working; these results describe old text and are discarded. */
  | { status: 'superseded' }
  | { status: 'note_missing' };

const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Make the note's AI-derived todos/reminders match `items`, without duplicating anything.
 *
 * - Everything is scoped to (userId, noteId); the AI result never supplies an id of any kind.
 * - The note row is locked, so concurrent analyses of one note are serialized, and results computed
 *   for an older version of the note are discarded (`expectedUpdatedAt` must still match).
 * - Existing item with the same fingerprint: kept (its due date refreshed only if the user has not
 *   touched it). New fingerprint: inserted unless the user previously deleted it (tombstone).
 *   Missing from the new result: removed, unless the user edited it or it is completed/handled.
 */
export async function reconcileNote(
  db: Db,
  params: { userId: string; noteId: string; expectedUpdatedAt: Date; items: ExtractedItem[] },
): Promise<ReconcileOutcome> {
  const { userId, noteId, expectedUpdatedAt } = params;
  const items = fingerprintItems(params.items);

  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({ updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
      .for('update');
    if (!note) return { status: 'note_missing' } as const;
    if (!sameInstant(note.updatedAt, expectedUpdatedAt)) return { status: 'superseded' } as const;

    const now = new Date();

    const existingTodos = await tx
      .select()
      .from(todos)
      .where(
        and(eq(todos.userId, userId), eq(todos.sourceNoteId, noteId), eq(todos.createdByAi, true)),
      );
    const existingReminders = await tx
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          eq(reminders.sourceNoteId, noteId),
          eq(reminders.createdByAi, true),
        ),
      );
    const tombstones = await tx
      .select({ kind: aiDismissed.kind, fp: aiDismissed.aiFingerprint })
      .from(aiDismissed)
      .where(and(eq(aiDismissed.userId, userId), eq(aiDismissed.sourceNoteId, noteId)));
    const dismissed = new Set(tombstones.map((t) => `${t.kind}:${t.fp}`));

    let created = 0;
    let updated = 0;
    let removed = 0;

    // ---- todos
    const todoByFp = new Map(existingTodos.map((t) => [t.aiFingerprint, t]));
    const keepTodoFps = new Set<string>();
    for (const item of items.filter((i) => i.kind === 'todo')) {
      keepTodoFps.add(item.fingerprint);
      const existing = todoByFp.get(item.fingerprint);
      if (existing) {
        const editable = !existing.userModified && !existing.completed;
        if (
          editable &&
          (!sameInstant(existing.dueAt, item.dueAt) || existing.dueHasTime !== item.dueHasTime)
        ) {
          await tx
            .update(todos)
            .set({ dueAt: item.dueAt, dueHasTime: item.dueHasTime, updatedAt: now })
            .where(and(eq(todos.id, existing.id), eq(todos.userId, userId)));
          updated++;
        }
      } else if (!dismissed.has(`todo:${item.fingerprint}`)) {
        await tx.insert(todos).values({
          userId,
          sourceNoteId: noteId,
          title: item.text,
          dueAt: item.dueAt,
          dueHasTime: item.dueHasTime,
          createdByAi: true,
          aiFingerprint: item.fingerprint,
        });
        created++;
      }
    }
    const staleTodos = existingTodos.filter(
      (t) => !keepTodoFps.has(t.aiFingerprint ?? '') && !t.userModified && !t.completed,
    );
    if (staleTodos.length > 0) {
      await tx.delete(todos).where(
        and(
          eq(todos.userId, userId),
          inArray(
            todos.id,
            staleTodos.map((t) => t.id),
          ),
        ),
      );
      removed += staleTodos.length;
    }

    // ---- reminders
    const reminderByFp = new Map(existingReminders.map((r) => [r.aiFingerprint, r]));
    const keepReminderFps = new Set<string>();
    for (const item of items.filter((i) => i.kind === 'reminder')) {
      keepReminderFps.add(item.fingerprint);
      const existing = reminderByFp.get(item.fingerprint);
      if (existing) {
        const editable = !existing.userModified && existing.status === 'pending';
        if (
          editable &&
          (!sameInstant(existing.dueAt, item.dueAt) || existing.dueHasTime !== item.dueHasTime)
        ) {
          await tx
            .update(reminders)
            .set({
              dueAt: item.dueAt,
              dueHasTime: item.dueHasTime,
              alertedAt: null,
              updatedAt: now,
            })
            .where(and(eq(reminders.id, existing.id), eq(reminders.userId, userId)));
          updated++;
        }
      } else if (!dismissed.has(`reminder:${item.fingerprint}`)) {
        await tx.insert(reminders).values({
          userId,
          sourceNoteId: noteId,
          content: item.text,
          person: item.person,
          dueAt: item.dueAt,
          dueHasTime: item.dueHasTime,
          createdByAi: true,
          aiFingerprint: item.fingerprint,
        });
        created++;
      }
    }
    const staleReminders = existingReminders.filter(
      (r) =>
        !keepReminderFps.has(r.aiFingerprint ?? '') && !r.userModified && r.status === 'pending',
    );
    if (staleReminders.length > 0) {
      await tx.delete(reminders).where(
        and(
          eq(reminders.userId, userId),
          inArray(
            reminders.id,
            staleReminders.map((r) => r.id),
          ),
        ),
      );
      removed += staleReminders.length;
    }

    await tx
      .update(notes)
      .set({ analysisStatus: 'ok', analysisError: null })
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));

    return { status: 'applied', created, updated, removed } as const;
  });
}
