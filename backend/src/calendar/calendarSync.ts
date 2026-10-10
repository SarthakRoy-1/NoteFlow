import { and, asc, eq, gte, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { googleCalendarConnections, reminders, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import type { CalendarFailure, GoogleCalendarApi } from './googleCalendar.js';
import { decryptToken, encryptToken } from './tokenCrypto.js';

const EVENT_LENGTH_MS = 30 * 60_000;
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Save (or replace) a user's connection. The refresh token is encrypted before it touches the database. */
export async function storeCalendarConnection(
  db: Db,
  secret: string,
  params: { userId: string; refreshToken: string; scope: string; googleEmail: string },
) {
  const values = {
    refreshTokenEnc: encryptToken(params.refreshToken, secret),
    scope: params.scope,
    googleEmail: params.googleEmail,
    status: 'connected',
    lastError: null,
    updatedAt: new Date(),
  };
  await db
    .insert(googleCalendarConnections)
    .values({ userId: params.userId, ...values })
    .onConflictDoUpdate({ target: googleCalendarConnections.userId, set: values });
}

export type SyncResult = 'synced' | 'skipped' | 'failed';

/** How many reminders one "sync existing reminders" call sends (a Google call or two each). */
export const SYNC_BATCH = 25;

export interface SyncAllResult {
  /** "needs_reconnect": Google refused the stored grant (before or during the run). */
  result: 'ok' | 'not_connected' | 'needs_reconnect';
  /** Events created or updated by this call. */
  synced: number;
  /** Reminders Google refused this time (temporary errors); they stay saved and are retried. */
  failed: number;
  /** Eligible reminders still waiting after this call (press the button again). */
  remaining: number;
}

/** What the Settings page needs to know, with no token or other secret in it. */
export interface CalendarStatus {
  /** This server has Google OAuth credentials, so connecting is possible at all. */
  available: boolean;
  connected: boolean;
  /** "needs_reconnect": Google no longer accepts the stored grant. */
  status: 'connected' | 'needs_reconnect' | null;
  googleEmail: string | null;
}

/** The Google event id for a reminder: its UUID without dashes (valid base32hex: 0-9, a-f). */
export const eventIdFor = (reminderId: string) => reminderId.replaceAll('-', '').toLowerCase();

/**
 * Mirrors saved reminders into the connected user's Google Calendar. Every method is safe to call
 * for anyone: without a connection it does nothing, and it NEVER throws, so a calendar problem can
 * never fail or roll back saving a reminder. Only complete reminders (a real date AND time) are
 * ever sent; incomplete ones are not reminders yet and never reach this class.
 */
export class CalendarSync {
  constructor(
    private readonly db: Db,
    private readonly api: GoogleCalendarApi | null,
    private readonly secret: string,
  ) {}

  get available() {
    return this.api !== null;
  }

  private async connection(userId: string) {
    const [row] = await this.db
      .select()
      .from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId));
    return row ?? null;
  }

  private async markFailed(userId: string, failure: CalendarFailure) {
    if (failure !== 'revoked' && failure !== 'no_permission') {
      logger.warn('Google Calendar sync failed', { failure });
      return;
    }
    // The grant is unusable: stop trying until the user reconnects.
    await this.db
      .update(googleCalendarConnections)
      .set({ status: 'needs_reconnect', lastError: failure, updatedAt: new Date() })
      .where(eq(googleCalendarConnections.userId, userId));
    logger.warn('Google Calendar needs reconnecting', { failure });
  }

  /** Create or update the event for one reminder, when it is complete and the user is connected. */
  async syncReminder(userId: string, reminderId: string): Promise<SyncResult> {
    try {
      if (!this.api) return 'skipped';
      const conn = await this.connection(userId);
      if (!conn || conn.status !== 'connected') return 'skipped';

      const [row] = await this.db
        .select()
        .from(reminders)
        .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)));
      // Not a complete reminder: nothing to put in a calendar.
      if (!row || !row.dueAt || !row.dueHasTime) return 'skipped';
      if (row.recurrenceDays && row.recurrenceTime === null) return 'skipped';
      // Handled reminders keep whatever event they already have.
      if (row.status !== 'pending') return 'skipped';
      // Up to date already: nothing that appears in the event changed since it was sent.
      if (row.googleEventId && row.calendarSyncedAt) return 'skipped';

      const refreshToken = decryptToken(conn.refreshTokenEnc, this.secret);
      if (!refreshToken) {
        await this.markFailed(userId, 'revoked');
        return 'failed';
      }
      const [owner] = await this.db
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const person = row.person ? ` (for ${row.person})` : '';
      const outcome = await this.api.upsertEvent(refreshToken, {
        eventId: row.googleEventId ?? eventIdFor(row.id),
        summary: `${row.content}${person}`,
        description: 'Created by NoteFlow from one of your notes.',
        start: row.dueAt,
        end: new Date(row.dueAt.getTime() + EVENT_LENGTH_MS),
        timeZone: owner?.timezone ?? 'UTC',
        rrule: row.recurrenceDays
          ? `RRULE:FREQ=WEEKLY;BYDAY=${[...row.recurrenceDays]
              .sort((a, b) => a - b)
              .map((d) => BYDAY[d - 1])
              .join(',')}`
          : null,
        reminderId: row.id,
      });
      if (!outcome.ok) {
        await this.markFailed(userId, outcome.failure);
        return 'failed';
      }
      await this.db
        .update(reminders)
        .set({ googleEventId: outcome.eventId })
        .where(and(eq(reminders.id, row.id), eq(reminders.userId, userId)));
      // "In sync" is recorded only if the row is still the version we sent: an edit made while the
      // request was in flight keeps the event marked stale, so it is sent again next time.
      await this.db
        .update(reminders)
        .set({ calendarSyncedAt: new Date() })
        .where(
          and(
            eq(reminders.id, row.id),
            eq(reminders.userId, userId),
            // PostgreSQL keeps microseconds, the JS snapshot milliseconds: compare at ms precision.
            sql`date_trunc('milliseconds', ${reminders.updatedAt}) = ${row.updatedAt}`,
            isNull(reminders.calendarSyncedAt),
          ),
        );
      return 'synced';
    } catch (err) {
      logger.warn('Google Calendar sync errored', { name: (err as Error).name });
      return 'failed';
    }
  }

  /** Sync every pending reminder that came from one note (after the note was analysed). */
  async syncNote(userId: string, noteId: string): Promise<void> {
    try {
      if (!this.api || !(await this.connection(userId))) return;
      const rows = await this.db
        .select({ id: reminders.id })
        .from(reminders)
        .where(and(eq(reminders.userId, userId), eq(reminders.sourceNoteId, noteId)));
      for (const r of rows) await this.syncReminder(userId, r.id);
    } catch (err) {
      logger.warn('Google Calendar note sync errored', { name: (err as Error).name });
    }
  }

  /**
   * Eligible reminders that still need sending: pending, with a real date AND time, not already in
   * step with their event, and either upcoming or repeating (a one-off in the past is pointless).
   * Always scoped to the one user; drafts live in another table and can never match.
   */
  private stale(userId: string, now: Date): SQL {
    return and(
      eq(reminders.userId, userId),
      eq(reminders.status, 'pending'),
      isNotNull(reminders.dueAt),
      eq(reminders.dueHasTime, true),
      or(isNull(reminders.googleEventId), isNull(reminders.calendarSyncedAt)),
      or(gte(reminders.dueAt, now), isNotNull(reminders.recurrenceDays)),
      // A repeating reminder is only complete with its time of day.
      or(isNull(reminders.recurrenceDays), isNotNull(reminders.recurrenceTime)),
    ) as SQL;
  }

  /**
   * "Sync existing reminders": sends up to SYNC_BATCH stale reminders of this user. Safe to repeat:
   * event ids are derived from reminder ids, so a retry updates instead of duplicating, and nothing
   * is ever deleted. A temporary failure for one reminder does not stop the others.
   */
  async syncAll(userId: string, now: Date = new Date()): Promise<SyncAllResult> {
    try {
      const conn = this.api ? await this.connection(userId) : null;
      if (!conn) return { result: 'not_connected', synced: 0, failed: 0, remaining: 0 };
      if (conn.status !== 'connected') {
        return { result: 'needs_reconnect', synced: 0, failed: 0, remaining: 0 };
      }
      const rows = await this.db
        .select({ id: reminders.id })
        .from(reminders)
        .where(this.stale(userId, now))
        .orderBy(asc(reminders.dueAt), asc(reminders.id))
        .limit(SYNC_BATCH);
      let synced = 0;
      let failed = 0;
      for (const r of rows) {
        const outcome = await this.syncReminder(userId, r.id);
        if (outcome === 'synced') synced += 1;
        if (outcome === 'failed') failed += 1;
        // The grant died mid-run: stop instead of failing every remaining reminder.
        if ((await this.connection(userId))?.status !== 'connected') break;
      }
      const after = await this.connection(userId);
      const [left] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(reminders)
        .where(this.stale(userId, now));
      return {
        result: after?.status === 'connected' ? 'ok' : 'needs_reconnect',
        synced,
        failed,
        remaining: left?.n ?? 0,
      };
    } catch (err) {
      logger.warn('Google Calendar bulk sync errored', { name: (err as Error).name });
      return { result: 'ok', synced: 0, failed: 0, remaining: 0 };
    }
  }

  /** Remove events whose reminders were deleted. Failures are logged; the reminder is gone anyway. */
  async removeEvents(userId: string, eventIds: string[]): Promise<void> {
    try {
      const ids = eventIds.filter(Boolean);
      if (!this.api || ids.length === 0) return;
      const conn = await this.connection(userId);
      if (!conn || conn.status !== 'connected') return;
      const refreshToken = decryptToken(conn.refreshTokenEnc, this.secret);
      if (!refreshToken) return;
      for (const id of ids) {
        const outcome = await this.api.deleteEvent(refreshToken, id);
        if (!outcome.ok) {
          await this.markFailed(userId, outcome.failure);
          if (outcome.failure === 'revoked' || outcome.failure === 'no_permission') return;
        }
      }
    } catch (err) {
      logger.warn('Google Calendar delete errored', { name: (err as Error).name });
    }
  }

  async eventIdsForReminders(userId: string, reminderIds: string[]): Promise<string[]> {
    if (reminderIds.length === 0) return [];
    const rows = await this.db
      .select({ id: reminders.googleEventId })
      .from(reminders)
      .where(and(eq(reminders.userId, userId), inArray(reminders.id, reminderIds)));
    return rows.flatMap((r) => (r.id ? [r.id] : []));
  }

  async eventIdsForNote(userId: string, noteId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: reminders.googleEventId })
      .from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.sourceNoteId, noteId)));
    return rows.flatMap((r) => (r.id ? [r.id] : []));
  }

  async status(userId: string, configured: boolean): Promise<CalendarStatus> {
    const conn = await this.connection(userId);
    return {
      available: configured && this.api !== null,
      connected: conn !== null && conn.status === 'connected',
      status: conn ? (conn.status === 'connected' ? 'connected' : 'needs_reconnect') : null,
      googleEmail: conn?.googleEmail ?? null,
    };
  }

  /** Forget the connection, and ask Google to revoke the grant. Existing events are left in place. */
  async disconnect(userId: string): Promise<void> {
    const conn = await this.connection(userId);
    if (!conn) return;
    const token = decryptToken(conn.refreshTokenEnc, this.secret);
    await this.db
      .delete(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId));
    // Events stay in the user's calendar, so the local pointers go (a later reconnect starts fresh).
    await this.db
      .update(reminders)
      .set({ googleEventId: null, calendarSyncedAt: null })
      .where(eq(reminders.userId, userId));
    if (token && this.api) await this.api.revoke(token);
  }
}
