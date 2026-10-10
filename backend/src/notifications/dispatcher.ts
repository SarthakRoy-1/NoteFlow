import { and, asc, eq, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  notificationDeliveries,
  notificationPreferences,
  pushSubscriptions,
  reminderShares,
  reminders,
  users,
} from '../db/schema.js';
import { EmailDeliveryError, type EmailSender } from '../email/types.js';
import { logger } from '../lib/logger.js';
import { previousOccurrence, ruleFromRow } from '../lib/recurrence.js';
import { reminderEmail, reminderPush, type ReminderNotice } from './messages.js';
import type { PushSender } from './push.js';

/**
 * A notification is only worth sending close to its time. Older than this it is dropped (and
 * recorded as skipped), so an outage or a freshly switched-on channel never floods anyone.
 */
export const LATE_WINDOW_MS = 3 * 60 * 60 * 1000;
/** A worker that died mid-send leaves its claim; after this another worker may take the row over. */
const STALE_CLAIM_MS = 5 * 60 * 1000;
const BATCH = 50;
const CANDIDATE_LIMIT = 2000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export interface DispatchDeps {
  db: Db;
  email: EmailSender;
  push: PushSender;
  appBaseUrl: string;
  now: () => Date;
}

export interface DispatchResult {
  enqueued: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

type Channel = 'email' | 'push';

const DEFAULT_PREFS = { emailEnabled: true, pushEnabled: true, pushShowText: false };

/** The reminder instant a notification would be for right now, or null when there is none. */
function currentOccurrence(
  row: {
    dueAt: Date | null;
    createdAt: Date;
    alertedAt: Date | null;
    recurrenceDays: number[] | null;
    recurrenceTime: string | null;
  },
  timezone: string,
  now: Date,
): Date | null {
  const since = now.getTime() - LATE_WINDOW_MS;
  const rule = ruleFromRow(row);
  let occurrence: Date | null;
  if (rule) {
    occurrence = previousOccurrence(rule, now, timezone);
    // Not before the reminder existed, and not one the owner already acknowledged.
    if (occurrence && occurrence.getTime() < row.createdAt.getTime()) return null;
    if (occurrence && row.alertedAt && row.alertedAt.getTime() >= occurrence.getTime()) return null;
  } else {
    occurrence = row.dueAt;
  }
  if (!occurrence) return null;
  const t = occurrence.getTime();
  return t <= now.getTime() && t >= since ? occurrence : null;
}

/**
 * Step 1: write a ledger row for everything that is due. Safe to repeat: the unique key means a
 * second run (or a second instance) inserts nothing new.
 */
async function enqueueDue(deps: DispatchDeps, now: Date): Promise<number> {
  const { db, email, push } = deps;
  if (!email.configured && !push.configured) return 0;
  const since = new Date(now.getTime() - LATE_WINDOW_MS);

  const candidates = await db
    .select({
      id: reminders.id,
      ownerId: reminders.userId,
      dueAt: reminders.dueAt,
      createdAt: reminders.createdAt,
      alertedAt: reminders.alertedAt,
      recurrenceDays: reminders.recurrenceDays,
      recurrenceTime: reminders.recurrenceTime,
      timezone: users.timezone,
    })
    .from(reminders)
    .innerJoin(users, eq(users.id, reminders.userId))
    .where(
      and(
        eq(reminders.status, 'pending'),
        isNotNull(reminders.dueAt),
        or(
          isNotNull(reminders.recurrenceDays),
          and(gte(reminders.dueAt, since), lte(reminders.dueAt, now)),
        ),
      ),
    )
    .limit(CANDIDATE_LIMIT);

  const due = candidates
    .map((c) => ({ ...c, occurrence: currentOccurrence(c, c.timezone, now) }))
    .filter((c): c is typeof c & { occurrence: Date } => c.occurrence !== null);
  if (due.length === 0) return 0;

  const shares = await db
    .select({
      reminderId: reminderShares.reminderId,
      recipientId: reminderShares.recipientId,
      createdAt: reminderShares.createdAt,
      acknowledgedAt: reminderShares.acknowledgedAt,
    })
    .from(reminderShares)
    .where(
      inArray(
        reminderShares.reminderId,
        due.map((d) => d.id),
      ),
    );
  const people = [...new Set([...due.map((d) => d.ownerId), ...shares.map((s) => s.recipientId)])];
  const prefRows = await db
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, people));
  const prefs = new Map(prefRows.map((p) => [p.userId, p]));
  const subscribed = new Set(
    (
      await db
        .selectDistinct({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(inArray(pushSubscriptions.userId, people))
    ).map((r) => r.userId),
  );

  const rows: (typeof notificationDeliveries.$inferInsert)[] = [];
  const want = (reminderId: string, recipientId: string, occurrenceAt: Date) => {
    const pref = prefs.get(recipientId) ?? DEFAULT_PREFS;
    const channels: Channel[] = [];
    if (email.configured && pref.emailEnabled) channels.push('email');
    if (push.configured && pref.pushEnabled && subscribed.has(recipientId)) channels.push('push');
    for (const channel of channels) {
      rows.push({ reminderId, recipientId, channel, occurrenceAt, nextAttemptAt: now });
    }
  };
  for (const d of due) {
    want(d.id, d.ownerId, d.occurrence);
    for (const s of shares.filter((x) => x.reminderId === d.id)) {
      // An occurrence from before it was shared, or one the recipient already handled, is not theirs.
      if (d.occurrence.getTime() < s.createdAt.getTime()) continue;
      if (s.acknowledgedAt && s.acknowledgedAt.getTime() >= d.occurrence.getTime()) continue;
      want(d.id, s.recipientId, d.occurrence);
    }
  }
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(notificationDeliveries)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });
  return inserted.length;
}

type Delivery = typeof notificationDeliveries.$inferSelect;
type Outcome =
  | { status: 'sent' }
  | { status: 'skipped' | 'failed'; reason: string }
  | { status: 'retry'; reason: string };

/** Step 2a: take a batch. SKIP LOCKED means two workers never hold the same row. */
async function claim(db: Db, now: Date): Promise<Delivery[]> {
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  return db.transaction(async (tx) => {
    const ids = await tx
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        or(
          and(
            eq(notificationDeliveries.status, 'pending'),
            lte(notificationDeliveries.nextAttemptAt, now),
          ),
          and(
            eq(notificationDeliveries.status, 'sending'),
            lt(notificationDeliveries.claimedAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(notificationDeliveries.nextAttemptAt))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    if (ids.length === 0) return [];
    return tx
      .update(notificationDeliveries)
      .set({
        status: 'sending',
        claimedAt: now,
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        inArray(
          notificationDeliveries.id,
          ids.map((i) => i.id),
        ),
      )
      .returning();
  });
}

/** Step 2b: re-check everything against the current data, then send on the delivery's channel. */
async function deliver(deps: DispatchDeps, d: Delivery, now: Date): Promise<Outcome> {
  const { db, email, push, appBaseUrl } = deps;
  if (now.getTime() - d.occurrenceAt.getTime() > LATE_WINDOW_MS) {
    return { status: 'skipped', reason: 'stale' };
  }
  const [r] = await db
    .select({
      content: reminders.content,
      person: reminders.person,
      dueAt: reminders.dueAt,
      dueHasTime: reminders.dueHasTime,
      status: reminders.status,
      alertedAt: reminders.alertedAt,
      recurrenceDays: reminders.recurrenceDays,
      recurrenceTime: reminders.recurrenceTime,
      ownerId: reminders.userId,
      ownerName: users.name,
    })
    .from(reminders)
    .innerJoin(users, eq(users.id, reminders.userId))
    .where(eq(reminders.id, d.reminderId));
  if (!r) return { status: 'skipped', reason: 'reminder_gone' };
  if (r.status !== 'pending') return { status: 'skipped', reason: 'not_pending' };
  const rule = ruleFromRow(r);
  if (rule) {
    if (
      r.alertedAt &&
      r.alertedAt.getTime() >= d.occurrenceAt.getTime() &&
      d.recipientId === r.ownerId
    ) {
      return { status: 'skipped', reason: 'acknowledged' };
    }
  } else if (r.dueAt?.getTime() !== d.occurrenceAt.getTime()) {
    return { status: 'skipped', reason: 'rescheduled' };
  }

  const [person] = await db
    .select({ email: users.email, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, d.recipientId));
  if (!person) return { status: 'skipped', reason: 'recipient_gone' };

  const isOwner = d.recipientId === r.ownerId;
  if (!isOwner) {
    const [share] = await db
      .select({ acknowledgedAt: reminderShares.acknowledgedAt })
      .from(reminderShares)
      .where(
        and(
          eq(reminderShares.reminderId, d.reminderId),
          eq(reminderShares.recipientId, d.recipientId),
        ),
      );
    if (!share) return { status: 'skipped', reason: 'share_revoked' };
    if (share.acknowledgedAt && share.acknowledgedAt.getTime() >= d.occurrenceAt.getTime()) {
      return { status: 'skipped', reason: 'acknowledged' };
    }
  }

  const [prefRow] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, d.recipientId));
  const pref = prefRow ?? DEFAULT_PREFS;
  const notice: ReminderNotice = {
    text: r.content,
    person: r.person,
    occurrenceAt: d.occurrenceAt,
    hasTime: rule ? rule.time !== null : r.dueHasTime,
    timezone: person.timezone,
    sharedBy: isOwner ? null : r.ownerName,
  };

  if (d.channel === 'email') {
    if (!pref.emailEnabled) return { status: 'skipped', reason: 'disabled' };
    if (!email.configured) return { status: 'skipped', reason: 'not_configured' };
    try {
      await email.send(reminderEmail(person.email, appBaseUrl, notice, d.id));
      return { status: 'sent' };
    } catch (err) {
      if (err instanceof EmailDeliveryError && err.kind === 'rejected') {
        return { status: 'failed', reason: 'rejected' }; // e.g. an address the provider refuses
      }
      return { status: 'retry', reason: 'unavailable' };
    }
  }

  if (!pref.pushEnabled) return { status: 'skipped', reason: 'disabled' };
  if (!push.configured) return { status: 'skipped', reason: 'not_configured' };
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, d.recipientId));
  if (subs.length === 0) return { status: 'skipped', reason: 'no_subscription' };

  const payload = reminderPush(notice, pref.pushShowText, d.id);
  // Web Push collapses messages that share a topic, so a retry replaces rather than repeats.
  const options = { topic: d.id.replaceAll('-', ''), ttlSeconds: LATE_WINDOW_MS / 1000 };
  let delivered = 0;
  let transient = 0;
  for (const sub of subs) {
    const outcome = await push.send(sub, payload, options);
    if (outcome === 'sent') {
      delivered++;
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: now })
        .where(eq(pushSubscriptions.id, sub.id));
    } else if (outcome === 'gone') {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    } else if (outcome === 'unavailable') {
      transient++;
    }
  }
  if (delivered > 0) return { status: 'sent' };
  if (transient > 0) return { status: 'retry', reason: 'unavailable' };
  return { status: 'failed', reason: 'rejected' };
}

async function finish(
  db: Db,
  d: Delivery,
  outcome: Outcome,
  now: Date,
): Promise<keyof DispatchResult> {
  const base = { claimedAt: null, updatedAt: now };
  let patch: Partial<typeof notificationDeliveries.$inferInsert>;
  let counted: keyof DispatchResult;
  if (outcome.status === 'sent') {
    patch = { ...base, status: 'sent', sentAt: now, lastError: null };
    counted = 'sent';
  } else if (outcome.status === 'retry' && d.attempts < MAX_ATTEMPTS) {
    const wait = BACKOFF_MS[Math.min(d.attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS.at(-1)!;
    patch = {
      ...base,
      status: 'pending',
      nextAttemptAt: new Date(now.getTime() + wait),
      lastError: outcome.reason,
    };
    counted = 'retried';
  } else if (outcome.status === 'skipped') {
    patch = { ...base, status: 'skipped', lastError: outcome.reason };
    counted = 'skipped';
  } else {
    // A permanent failure, or a transient one that ran out of attempts.
    patch = {
      ...base,
      status: 'failed',
      lastError: outcome.status === 'failed' ? outcome.reason : 'gave_up',
    };
    counted = 'failed';
  }
  // Only the worker that still holds the claim may record the result.
  await db
    .update(notificationDeliveries)
    .set(patch)
    .where(and(eq(notificationDeliveries.id, d.id), eq(notificationDeliveries.status, 'sending')));
  return counted;
}

/** One scheduler tick. Everything it needs to remember lives in PostgreSQL. */
export async function runDispatch(deps: DispatchDeps): Promise<DispatchResult> {
  const now = deps.now();
  const result: DispatchResult = { enqueued: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  result.enqueued = await enqueueDue(deps, now);
  // Keep going while full batches come back, so a backlog drains in one tick.
  for (let round = 0; round < 20; round++) {
    const batch = await claim(deps.db, now);
    for (const d of batch) {
      let outcome: Outcome;
      try {
        outcome = await deliver(deps, d, now);
      } catch (err) {
        // Log the type only: errors can carry addresses or reminder text.
        logger.warn('Notification delivery errored', { name: (err as Error).name });
        outcome = { status: 'retry', reason: 'error' };
      }
      const counted = await finish(deps.db, d, outcome, now);
      if (counted !== 'enqueued') result[counted]++;
    }
    if (batch.length < BATCH) break;
  }
  return result;
}
