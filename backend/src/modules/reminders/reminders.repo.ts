import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { aiDismissed, notes, reminderShares, reminders, users } from '../../db/schema.js';
import {
  localTimeOf,
  localWeekdayOf,
  nextOccurrence,
  normalizeDays,
  ruleFromRow,
  type Recurrence,
} from '../../lib/recurrence.js';
import type { ResolvedDue } from './reminders.schemas.js';

export interface ReminderDto {
  id: string;
  text: string;
  /** A person named in the note. Informational only: use "share" to really notify a user. */
  person: string | null;
  /** UTC instant, or null when the note gave no date/time (such a reminder never alerts). */
  dueAt: string | null;
  /** false = only a date was given; dueAt is then the start of that local day. */
  dueHasTime: boolean;
  /** Repeating reminders: the weekdays (1 = Monday ... 7 = Sunday) and the time of day. */
  recurrence: { days: number[]; time: string | null } | null;
  status: 'pending' | 'acknowledged' | 'dismissed';
  /** When the user last acknowledged it (for a repeating reminder: its latest occurrence). */
  acknowledgedAt: string | null;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  /** The note this reminder came from (always present: deleting the note deletes its reminders). */
  sourceNote: { id: string; title: string };
  /** The users this reminder was explicitly shared with (visible to its owner only). */
  sharedWith: { shareId: string; name: string; email: string }[];
}

const LIST_LIMIT = 500;
const DUE_LIMIT = 50;

const selection = {
  id: reminders.id,
  text: reminders.content,
  person: reminders.person,
  dueAt: reminders.dueAt,
  dueHasTime: reminders.dueHasTime,
  recurrenceDays: reminders.recurrenceDays,
  recurrenceTime: reminders.recurrenceTime,
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
  recurrenceDays: number[] | null;
  recurrenceTime: string | null;
  status: 'pending' | 'acknowledged' | 'dismissed';
  alertedAt: Date | null;
  createdByAi: boolean;
  createdAt: Date;
  updatedAt: Date;
  noteId: string;
  noteTitle: string;
};

type Shares = Map<string, ReminderDto['sharedWith']>;

const toDto = (r: Row, shares: Shares): ReminderDto => {
  const rule = ruleFromRow(r);
  return {
    id: r.id,
    text: r.text,
    person: r.person,
    dueAt: r.dueAt?.toISOString() ?? null,
    dueHasTime: r.dueHasTime,
    recurrence: rule,
    status: r.status,
    // A repeating reminder stays "pending" (it re-arms), so its last acknowledgement is shown too.
    acknowledgedAt: r.status === 'pending' && !rule ? null : (r.alertedAt?.toISOString() ?? null),
    createdByAi: r.createdByAi,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    sourceNote: { id: r.noteId, title: r.noteTitle },
    sharedWith: shares.get(r.id) ?? [],
  };
};

// Every function takes the session-derived userId. The note join is ownership-scoped too, so a
// reminder can never expose a note title belonging to someone else.
const joinNote = and(eq(notes.id, reminders.sourceNoteId), eq(notes.userId, reminders.userId));

/** Recipients of the given reminders, as seen by their owner. */
async function sharesFor(db: Db, ownerId: string, reminderIds: string[]): Promise<Shares> {
  const map: Shares = new Map();
  if (reminderIds.length === 0) return map;
  const rows = await db
    .select({
      reminderId: reminderShares.reminderId,
      shareId: reminderShares.id,
      name: users.name,
      email: users.email,
    })
    .from(reminderShares)
    .innerJoin(users, eq(users.id, reminderShares.recipientId))
    .where(
      and(eq(reminderShares.ownerId, ownerId), inArray(reminderShares.reminderId, reminderIds)),
    )
    .orderBy(asc(reminderShares.createdAt), asc(reminderShares.id));
  for (const r of rows) {
    const list = map.get(r.reminderId) ?? [];
    list.push({ shareId: r.shareId, name: r.name, email: r.email });
    map.set(r.reminderId, list);
  }
  return map;
}

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
  const shares = await sharesFor(
    db,
    userId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toDto(r, shares));
}

export async function getReminder(db: Db, userId: string, id: string): Promise<ReminderDto | null> {
  const [row] = await db
    .select(selection)
    .from(reminders)
    .innerJoin(notes, joinNote)
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
    .limit(1);
  if (!row) return null;
  return toDto(row, await sharesFor(db, userId, [row.id]));
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
  const shares = await sharesFor(
    db,
    userId,
    rows.map((r) => r.id),
  );
  return {
    reminders: rows.map((r) => toDto(r, shares)),
    nextDueAt: next?.dueAt?.toISOString() ?? null,
  };
}

export interface ReminderChanges {
  text?: string;
  person?: string | null;
  due?: ResolvedDue;
  /** `null` stops repeating. Days are weekdays 1..7; the time of day comes from the due time. */
  recurrence?: { days: number[] } | null;
  acknowledged?: boolean;
}

/** "HH:mm" wall time of a stored due instant, or null when it was a date only. */
const timeOfDue = (due: ResolvedDue, timezone: string): string | null =>
  due.dueAt && due.dueHasTime ? localTimeOf(due.dueAt, timezone) : null;

/**
 * Apply an edit in one transaction on the locked row. Editing text, person, due date or schedule
 * marks the reminder `user_modified`, so a later re-analysis never overwrites or removes it. A
 * changed schedule re-arms the alert (back to pending).
 *
 * Acknowledging a ONE-OFF reminder marks it acknowledged. Acknowledging a REPEATING reminder that
 * is due advances it to its next occurrence (strictly after now, so missed ones are not queued);
 * when nothing is due it does nothing, so a double click or a second tab cannot skip an occurrence.
 *
 * Returns false when no reminder owned by `userId` matched.
 */
export async function updateReminder(
  db: Db,
  userId: string,
  id: string,
  changes: ReminderChanges,
  now: Date,
  timezone: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .for('update');
    if (!row) return false;

    const set: Partial<typeof reminders.$inferInsert> = { updatedAt: now };
    const currentRule = ruleFromRow(row);

    if (changes.text !== undefined) {
      set.content = changes.text;
      set.userModified = true;
    }
    if (changes.person !== undefined) {
      set.person = changes.person;
      set.userModified = true;
    }
    // Anything that shows up in a calendar event makes the stored event stale.
    if (
      changes.text !== undefined ||
      changes.person !== undefined ||
      changes.due !== undefined ||
      changes.recurrence !== undefined
    ) {
      set.calendarSyncedAt = null;
    }

    const touchesSchedule = changes.due !== undefined || changes.recurrence !== undefined;
    if (touchesSchedule) {
      set.userModified = true;
      const due: ResolvedDue = changes.due ?? { dueAt: row.dueAt, dueHasTime: row.dueHasTime };

      let rule: Recurrence | null;
      if (changes.recurrence === null) {
        rule = null;
      } else if (changes.recurrence) {
        const days = normalizeDays(changes.recurrence.days);
        rule = days ? { days, time: timeOfDue(due, timezone) } : null;
      } else {
        // Only the due changed: a repeating reminder keeps repeating, at the new time of day.
        rule = currentRule ? { days: currentRule.days, time: timeOfDue(due, timezone) } : null;
      }

      if (rule) {
        // The typed date is used when it is still ahead and falls on one of the schedule's days.
        const typed = due.dueAt;
        const typedFits =
          changes.due !== undefined &&
          typed !== null &&
          typed.getTime() > now.getTime() &&
          rule.days.includes(localWeekdayOf(typed, timezone));
        set.dueAt = typedFits ? typed : nextOccurrence(rule, now, timezone);
        set.dueHasTime = rule.time !== null;
        set.recurrenceDays = rule.days;
        set.recurrenceTime = rule.time;
      } else {
        set.dueAt = due.dueAt;
        set.dueHasTime = due.dueHasTime;
        set.recurrenceDays = null;
        set.recurrenceTime = null;
      }
      if (changes.acknowledged === undefined) {
        set.status = 'pending';
        set.alertedAt = null;
      }
    }

    if (changes.acknowledged === true) {
      if (!currentRule) {
        set.status = 'acknowledged';
        set.alertedAt = now;
      } else if (!touchesSchedule && row.status === 'pending' && row.dueAt && row.dueAt <= now) {
        set.dueAt = nextOccurrence(currentRule, now, timezone);
        set.alertedAt = now;
      }
    } else if (changes.acknowledged === false) {
      set.status = 'pending';
      set.alertedAt = null;
    }

    await tx
      .update(reminders)
      .set(set)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)));
    return true;
  });
}

/**
 * Delete a reminder owned by `userId`. AI-created reminders leave a tombstone first (with their
 * text, so a reworded copy is not brought back either), and its shares go with it.
 */
export async function deleteReminder(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        sourceNoteId: reminders.sourceNoteId,
        createdByAi: reminders.createdByAi,
        aiFingerprint: reminders.aiFingerprint,
        content: reminders.content,
        aiText: reminders.aiText,
        person: reminders.person,
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
          itemText: row.aiText ?? row.content,
          person: row.person,
        })
        .onConflictDoNothing();
    }
    await tx.delete(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, userId)));
    return true;
  });
}
