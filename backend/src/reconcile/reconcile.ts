import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { ExtractedItem } from '../ai/extraction/validate.js';
import type { Db } from '../db/client.js';
import { aiDismissed, notes, reminderDrafts, reminders, todos } from '../db/schema.js';
import { isCompleteReminder } from '../lib/reminderCompleteness.js';
import { ruleFromRow, sameRule, type Recurrence } from '../lib/recurrence.js';
import { fingerprintItems } from './fingerprint.js';
import { matchRewordings } from './similarity.js';

export type ReconcileOutcome =
  | {
      status: 'applied';
      created: number;
      updated: number;
      removed: number;
      /** Reminders the AI found but that still lack a date and time (kept as drafts, not reminders). */
      drafts: number;
      /** Calendar events of reminders this run deleted, so the caller can remove them from Google. */
      removedEventIds: string[];
    }
  /** The note changed while the AI was working; these results describe old text and are discarded. */
  | { status: 'superseded' }
  | { status: 'note_missing' };

const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** The current text and, when different, the model's original wording (older rows have none). */
const wordings = (current: string, original: string | null): string[] =>
  original && original !== current ? [current, original] : [current];

/**
 * Make the note's AI-derived todos/reminders match `items`, without duplicating anything.
 *
 * - Everything is scoped to (userId, noteId); the AI result never supplies an id of any kind.
 * - The note row is locked, so concurrent analyses of one note are serialized, and results computed
 *   for an older version of the note are discarded (`expectedUpdatedAt` must still match).
 * - Existing item with the same fingerprint: kept (its due date refreshed only if the user has not
 *   touched it). New fingerprint: inserted unless the user previously deleted it (tombstone).
 *   Missing from the new result: removed, unless the user edited it or it is completed/handled.
 * - A reworded copy of an item the user protected (edited/completed) or deleted is recognised by
 *   its text and not inserted again, so re-analysis cannot resurrect or duplicate it.
 * - A repeating reminder keeps its live `dueAt` (the next occurrence, possibly already due and
 *   unacknowledged) unless its schedule itself changed.
 */
export async function reconcileNote(
  db: Db,
  params: {
    userId: string;
    noteId: string;
    expectedUpdatedAt: Date;
    items: ExtractedItem[];
    /** The owner's IANA zone: only used to show a stated date back to them (never to guess a time). */
    timezone?: string;
  },
): Promise<ReconcileOutcome> {
  const { userId, noteId, expectedUpdatedAt } = params;
  const timezone = params.timezone ?? 'UTC';
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
      .select({
        kind: aiDismissed.kind,
        fp: aiDismissed.aiFingerprint,
        itemText: aiDismissed.itemText,
        person: aiDismissed.person,
      })
      .from(aiDismissed)
      .where(and(eq(aiDismissed.userId, userId), eq(aiDismissed.sourceNoteId, noteId)));
    const dismissed = new Set(tombstones.map((t) => `${t.kind}:${t.fp}`));
    const dismissedTexts = (kind: 'todo' | 'reminder') =>
      tombstones
        .filter((t) => t.kind === kind && t.itemText)
        .map((t) => ({ text: t.itemText as string, person: t.person }));

    let created = 0;
    let updated = 0;
    let removed = 0;
    const removedEventIds: string[] = [];

    // ---- todos
    const incomingTodos = items.filter((i) => i.kind === 'todo');
    const todoByFp = new Map(existingTodos.map((t) => [t.aiFingerprint, t]));
    const incomingTodoFps = new Set(incomingTodos.map((i) => i.fingerprint));
    const todoRewordings = matchRewordings(
      incomingTodos
        .filter((i) => !todoByFp.has(i.fingerprint) && !dismissed.has(`todo:${i.fingerprint}`))
        .map((i) => ({ fingerprint: i.fingerprint, text: i.text, person: null })),
      existingTodos
        .filter(
          (t) =>
            t.aiFingerprint !== null &&
            !incomingTodoFps.has(t.aiFingerprint) &&
            (t.userModified || t.completed),
        )
        // Both wordings: what the user made of it, and what the model originally said.
        .flatMap((t) =>
          wordings(t.title, t.aiText).map((text) => ({
            fingerprint: t.aiFingerprint as string,
            text,
            person: null,
          })),
        ),
      dismissedTexts('todo'),
    );

    const keepTodoFps = new Set<string>();
    for (const item of incomingTodos) {
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
        continue;
      }
      if (dismissed.has(`todo:${item.fingerprint}`)) continue;
      const rewordingOf = todoRewordings.mergedInto.get(item.fingerprint);
      if (rewordingOf) {
        keepTodoFps.add(rewordingOf);
        continue;
      }
      if (todoRewordings.dismissed.has(item.fingerprint)) continue;

      await tx.insert(todos).values({
        userId,
        sourceNoteId: noteId,
        title: item.text,
        aiText: item.text,
        dueAt: item.dueAt,
        dueHasTime: item.dueHasTime,
        createdByAi: true,
        aiFingerprint: item.fingerprint,
      });
      created++;
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
    const incomingReminders = items.filter((i) => i.kind === 'reminder');
    const reminderByFp = new Map(existingReminders.map((r) => [r.aiFingerprint, r]));
    const incomingReminderFps = new Set(incomingReminders.map((i) => i.fingerprint));
    const reminderRewordings = matchRewordings(
      incomingReminders
        .filter(
          (i) => !reminderByFp.has(i.fingerprint) && !dismissed.has(`reminder:${i.fingerprint}`),
        )
        .map((i) => ({ fingerprint: i.fingerprint, text: i.text, person: i.person })),
      existingReminders
        .filter(
          (r) =>
            r.aiFingerprint !== null &&
            !incomingReminderFps.has(r.aiFingerprint) &&
            (r.userModified || r.status !== 'pending'),
        )
        .flatMap((r) =>
          wordings(r.content, r.aiText).map((text) => ({
            fingerprint: r.aiFingerprint as string,
            text,
            person: r.person,
          })),
        ),
      dismissedTexts('reminder'),
    );

    const keepReminderFps = new Set<string>();
    const draftFps = new Set<string>();
    for (const item of incomingReminders) {
      keepReminderFps.add(item.fingerprint);

      // Without a valid date AND time this is not a reminder yet: keep it as a draft the user
      // completes. An existing reminder (or one the user dismissed) is never touched by it.
      if (!isCompleteReminder(item)) {
        if (
          reminderByFp.has(item.fingerprint) ||
          dismissed.has(`reminder:${item.fingerprint}`) ||
          reminderRewordings.mergedInto.has(item.fingerprint) ||
          reminderRewordings.dismissed.has(item.fingerprint)
        ) {
          const into = reminderRewordings.mergedInto.get(item.fingerprint);
          if (into) keepReminderFps.add(into);
          continue;
        }
        draftFps.add(item.fingerprint);
        const suggestedDate =
          item.dueAt && !item.recurrenceDays
            ? DateTime.fromJSDate(item.dueAt, { zone: timezone }).toISODate()
            : null;
        await tx
          .insert(reminderDrafts)
          .values({
            userId,
            sourceNoteId: noteId,
            content: item.text,
            aiText: item.text,
            person: item.person,
            suggestedDate,
            recurrenceDays: item.recurrenceDays,
            aiFingerprint: item.fingerprint,
          })
          .onConflictDoUpdate({
            target: [reminderDrafts.sourceNoteId, reminderDrafts.aiFingerprint],
            set: {
              content: item.text,
              person: item.person,
              suggestedDate,
              recurrenceDays: item.recurrenceDays,
              updatedAt: now,
            },
          });
        continue;
      }

      const incomingRule: Recurrence | null = item.recurrenceDays
        ? { days: item.recurrenceDays, time: item.recurrenceTime }
        : null;
      const existing = reminderByFp.get(item.fingerprint);
      if (existing) {
        const editable = !existing.userModified && existing.status === 'pending';
        const ruleChanged = !sameRule(ruleFromRow(existing), incomingRule);
        // While the schedule is unchanged the stored dueAt is the live next occurrence: re-analysis
        // must not move it (it may be a due alert the user has not acknowledged yet).
        const dueMoved =
          incomingRule !== null && !ruleChanged
            ? false
            : !sameInstant(existing.dueAt, item.dueAt) || existing.dueHasTime !== item.dueHasTime;
        if (editable && (ruleChanged || dueMoved)) {
          await tx
            .update(reminders)
            .set({
              dueAt: item.dueAt,
              dueHasTime: item.dueHasTime,
              recurrenceDays: item.recurrenceDays,
              recurrenceTime: item.recurrenceTime,
              alertedAt: null,
              calendarSyncedAt: null,
              updatedAt: now,
            })
            .where(and(eq(reminders.id, existing.id), eq(reminders.userId, userId)));
          updated++;
        }
        continue;
      }
      if (dismissed.has(`reminder:${item.fingerprint}`)) continue;
      const rewordingOf = reminderRewordings.mergedInto.get(item.fingerprint);
      if (rewordingOf) {
        keepReminderFps.add(rewordingOf);
        continue;
      }
      if (reminderRewordings.dismissed.has(item.fingerprint)) continue;

      await tx.insert(reminders).values({
        userId,
        sourceNoteId: noteId,
        content: item.text,
        aiText: item.text,
        person: item.person,
        dueAt: item.dueAt,
        dueHasTime: item.dueHasTime,
        recurrenceDays: item.recurrenceDays,
        recurrenceTime: item.recurrenceTime,
        createdByAi: true,
        aiFingerprint: item.fingerprint,
      });
      created++;
    }
    const staleReminders = existingReminders.filter(
      (r) =>
        !keepReminderFps.has(r.aiFingerprint ?? '') && !r.userModified && r.status === 'pending',
    );
    for (const r of staleReminders) if (r.googleEventId) removedEventIds.push(r.googleEventId);
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

    // Drafts the note no longer produces (it was edited, or now gives a full date and time) go away.
    const existingDrafts = await tx
      .select({ id: reminderDrafts.id, fp: reminderDrafts.aiFingerprint })
      .from(reminderDrafts)
      .where(and(eq(reminderDrafts.userId, userId), eq(reminderDrafts.sourceNoteId, noteId)));
    const staleDrafts = existingDrafts.filter((d) => !draftFps.has(d.fp));
    if (staleDrafts.length > 0) {
      await tx.delete(reminderDrafts).where(
        and(
          eq(reminderDrafts.userId, userId),
          inArray(
            reminderDrafts.id,
            staleDrafts.map((d) => d.id),
          ),
        ),
      );
    }

    await tx
      .update(notes)
      .set({ analysisStatus: 'ok', analysisError: null })
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));

    return {
      status: 'applied',
      created,
      updated,
      removed,
      drafts: draftFps.size,
      removedEventIds,
    } as const;
  });
}
