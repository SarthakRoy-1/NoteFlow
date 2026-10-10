import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { reminderShares, reminders, users } from '../../db/schema.js';
import { nextOccurrence, previousOccurrence, ruleFromRow } from '../../lib/recurrence.js';

export const MAX_SHARES_PER_REMINDER = 10;
const LIST_LIMIT = 100;

/** A share as its OWNER sees it. */
export interface ShareDto {
  id: string;
  recipient: { name: string; email: string };
  createdAt: string;
  acknowledgedAt: string | null;
}

/**
 * A shared reminder as its RECIPIENT sees it. Deliberately small: the reminder's text and time, who
 * sent it. Never the source note, its title, the owner's email or any id of the reminder itself.
 */
export interface SharedReminderDto {
  /** The share's own id: the only handle the recipient has. */
  id: string;
  text: string;
  /** The reminder's current alert instant (UTC), or null when it has no time. */
  dueAt: string | null;
  dueHasTime: boolean;
  recurrence: { days: number[]; time: string | null } | null;
  from: { name: string };
  sharedAt: string;
  acknowledgedAt: string | null;
  /** true until the recipient first acknowledges it. */
  isNew: boolean;
  /** An occurrence has arrived and the recipient has not acknowledged it yet. */
  due: boolean;
  /** The occurrence that is due (a repeating reminder: its latest one), or null. */
  occurrenceAt: string | null;
}

export type ShareResult =
  | { status: 'created' | 'existing'; share: ShareDto }
  | { status: 'not_found' }
  | { status: 'limit' };

const toShareDto = (r: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
}): ShareDto => ({
  id: r.id,
  recipient: { name: r.name, email: r.email },
  createdAt: r.createdAt.toISOString(),
  acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
});

const shareColumns = {
  id: reminderShares.id,
  recipientId: reminderShares.recipientId,
  createdAt: reminderShares.createdAt,
  acknowledgedAt: reminderShares.acknowledgedAt,
  name: users.name,
  email: users.email,
};

/**
 * Share one of `ownerId`'s reminders with `recipientId`. Idempotent: sharing again returns the
 * existing share. The reminder is looked up with the owner's id, so a reminder id that belongs to
 * someone else is simply "not found".
 */
export async function shareReminder(
  db: Db,
  ownerId: string,
  reminderId: string,
  recipientId: string,
  now: Date,
): Promise<ShareResult> {
  return db.transaction(async (tx) => {
    // Locking the reminder serializes concurrent shares, so the per-reminder limit cannot be raced.
    const [reminder] = await tx
      .select({ id: reminders.id })
      .from(reminders)
      .where(and(eq(reminders.id, reminderId), eq(reminders.userId, ownerId)))
      .for('update');
    if (!reminder) return { status: 'not_found' } as const;

    const current = await tx
      .select(shareColumns)
      .from(reminderShares)
      .innerJoin(users, eq(users.id, reminderShares.recipientId))
      .where(and(eq(reminderShares.reminderId, reminderId), eq(reminderShares.ownerId, ownerId)));
    const existing = current.find((s) => s.recipientId === recipientId);
    if (existing) return { status: 'existing', share: toShareDto(existing) } as const;
    if (current.length >= MAX_SHARES_PER_REMINDER) return { status: 'limit' } as const;

    const [inserted] = await tx
      .insert(reminderShares)
      .values({ reminderId, ownerId, recipientId, createdAt: now })
      .returning({ id: reminderShares.id });
    if (!inserted) throw new Error('share insert returned no row');
    const [row] = await tx
      .select(shareColumns)
      .from(reminderShares)
      .innerJoin(users, eq(users.id, reminderShares.recipientId))
      .where(eq(reminderShares.id, inserted.id));
    if (!row) throw new Error('share vanished after insert');
    return { status: 'created', share: toShareDto(row) } as const;
  });
}

/** The owner's shares of one reminder, or null when the reminder is not theirs. */
export async function listSharesForReminder(
  db: Db,
  ownerId: string,
  reminderId: string,
): Promise<ShareDto[] | null> {
  const [reminder] = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, ownerId)));
  if (!reminder) return null;
  const rows = await db
    .select(shareColumns)
    .from(reminderShares)
    .innerJoin(users, eq(users.id, reminderShares.recipientId))
    .where(and(eq(reminderShares.reminderId, reminderId), eq(reminderShares.ownerId, ownerId)))
    .orderBy(asc(reminderShares.createdAt), asc(reminderShares.id));
  return rows.map(toShareDto);
}

/** Owner stops sharing. True when a share of that owner's reminder was removed. */
export async function revokeShare(
  db: Db,
  ownerId: string,
  reminderId: string,
  shareId: string,
): Promise<boolean> {
  const rows = await db
    .delete(reminderShares)
    .where(
      and(
        eq(reminderShares.id, shareId),
        eq(reminderShares.reminderId, reminderId),
        eq(reminderShares.ownerId, ownerId),
      ),
    )
    .returning({ id: reminderShares.id });
  return rows.length > 0;
}

/**
 * Everything shared with `recipientId`, newest first, with the alert state computed against the
 * server clock. A repeating reminder is evaluated from its own schedule (in its owner's timezone),
 * so the recipient is alerted each occurrence regardless of what the owner has acknowledged.
 */
export async function listSharedWithMe(
  db: Db,
  recipientId: string,
  now: Date,
): Promise<{ shared: SharedReminderDto[]; nextDueAt: string | null }> {
  const rows = await db
    .select({
      id: reminderShares.id,
      createdAt: reminderShares.createdAt,
      acknowledgedAt: reminderShares.acknowledgedAt,
      text: reminders.content,
      dueAt: reminders.dueAt,
      dueHasTime: reminders.dueHasTime,
      recurrenceDays: reminders.recurrenceDays,
      recurrenceTime: reminders.recurrenceTime,
      ownerName: users.name,
      ownerTimezone: users.timezone,
    })
    .from(reminderShares)
    // The reminder is joined with its recorded owner, so a share can never expose another user's row.
    .innerJoin(
      reminders,
      and(
        eq(reminders.id, reminderShares.reminderId),
        eq(reminders.userId, reminderShares.ownerId),
      ),
    )
    .innerJoin(users, eq(users.id, reminderShares.ownerId))
    .where(eq(reminderShares.recipientId, recipientId))
    .orderBy(desc(reminderShares.createdAt), desc(reminderShares.id))
    .limit(LIST_LIMIT);

  let nextDue: number | null = null;
  const shared = rows.map((r): SharedReminderDto => {
    const rule = ruleFromRow(r);
    let occurrence: Date | null;
    if (rule) {
      const latest = previousOccurrence(rule, now, r.ownerTimezone);
      // Occurrences from before it was shared are not alerts for the recipient.
      occurrence = latest && latest.getTime() >= r.createdAt.getTime() ? latest : null;
      const upcoming = nextOccurrence(rule, now, r.ownerTimezone).getTime();
      if (nextDue === null || upcoming < nextDue) nextDue = upcoming;
    } else {
      occurrence = r.dueAt && r.dueAt.getTime() <= now.getTime() ? r.dueAt : null;
      const ahead = r.dueAt && r.dueAt.getTime() > now.getTime() ? r.dueAt.getTime() : null;
      if (ahead !== null && (nextDue === null || ahead < nextDue)) nextDue = ahead;
    }
    const due =
      occurrence !== null &&
      (r.acknowledgedAt === null || r.acknowledgedAt.getTime() < occurrence.getTime());
    return {
      id: r.id,
      text: r.text,
      dueAt: r.dueAt?.toISOString() ?? null,
      dueHasTime: r.dueHasTime,
      recurrence: rule,
      from: { name: r.ownerName },
      sharedAt: r.createdAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      isNew: r.acknowledgedAt === null,
      due,
      occurrenceAt: due && occurrence ? occurrence.toISOString() : null,
    };
  });
  return { shared, nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString() };
}

/** Recipient acknowledges. Scoped by the recipient's own id: someone else's share id is "not found". */
export async function acknowledgeShared(
  db: Db,
  recipientId: string,
  shareId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(reminderShares)
    .set({ acknowledgedAt: now })
    .where(and(eq(reminderShares.id, shareId), eq(reminderShares.recipientId, recipientId)))
    .returning({ id: reminderShares.id });
  return rows.length > 0;
}

/** Recipient removes a share from their own list. The owner's reminder is untouched. */
export async function removeSharedWithMe(
  db: Db,
  recipientId: string,
  shareId: string,
): Promise<boolean> {
  const rows = await db
    .delete(reminderShares)
    .where(and(eq(reminderShares.id, shareId), eq(reminderShares.recipientId, recipientId)))
    .returning({ id: reminderShares.id });
  return rows.length > 0;
}

/** Count helper used by tests and diagnostics. */
export async function countShares(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(reminderShares);
  return row?.n ?? 0;
}
