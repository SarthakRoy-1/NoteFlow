import { Router } from 'express';
import type { CalendarSync } from '../../calendar/calendarSync.js';
import type { Db } from '../../db/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rateLimit.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { findUserByEmail } from '../users/users.repo.js';
import * as shares from '../shares/shares.repo.js';
import { parseShareId, shareBody } from '../shares/shares.schemas.js';
import * as repo from './reminders.repo.js';
import {
  parseReminderId,
  REMINDER_NOT_FOUND,
  resolveReminderDue,
  updateReminderBody,
  type ResolvedDue,
} from './reminders.schemas.js';

export interface RemindersDeps {
  db: Db;
  /** The server clock (injectable for tests); alert eligibility is always decided here. */
  now: () => Date;
  /** Caps how fast one user can look up other accounts by email. */
  shareLimiter: RateLimiter;
  /** Mirrors saved reminders into the user's Google Calendar (a no-op without a connection). */
  sync: CalendarSync;
}

/**
 * Mounted behind requireAuth. Identity always comes from the session, never from the request.
 */
export function remindersRouter({ db, now, shareLimiter, sync }: RemindersDeps) {
  const router = Router();

  const load = async (userId: string, id: string) => {
    const reminder = await repo.getReminder(db, userId, id);
    if (!reminder) throw notFound(REMINDER_NOT_FOUND);
    return reminder;
  };

  router.get('/', async (req, res) => {
    res.json({ reminders: await repo.listReminders(db, currentUser(req).id) });
  });

  // Registered before '/:id' so "due" is never treated as an id.
  router.get('/due', async (req, res) => {
    res.json(await repo.getDueReminders(db, currentUser(req).id, now()));
  });

  router.get('/:id', async (req, res) => {
    res.json({ reminder: await load(currentUser(req).id, parseReminderId(req.params.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const user = currentUser(req);
    const id = parseReminderId(req.params.id);
    const input = updateReminderBody.parse(req.body);

    // A reminder always keeps a valid date AND time: it cannot be cleared or reduced to a date.
    // (Only reminders created before this rule can lack one; they stay editable otherwise.)
    if (input.due === null) {
      throw new AppError(
        'VALIDATION_FAILED',
        422,
        'A reminder needs a date and a time. Delete the reminder instead of clearing its date.',
      );
    }
    if (input.due !== undefined && !input.due.time) {
      throw new AppError('VALIDATION_FAILED', 422, 'A reminder needs a time as well as a date.');
    }
    if (input.recurrence && input.due === undefined) {
      const current = await load(user.id, id);
      if (!current.dueAt || !current.dueHasTime) {
        throw new AppError(
          'VALIDATION_FAILED',
          422,
          'Set a date and time before making a reminder repeat.',
        );
      }
    }

    // The due date is interpreted in the user's own timezone, taken from their account.
    let due: ResolvedDue | undefined;
    if (input.due !== undefined) {
      const resolved = resolveReminderDue(input.due, user.timezone);
      if (!resolved) {
        throw new AppError('VALIDATION_FAILED', 422, 'That is not a valid due date.');
      }
      due = resolved;
    }

    const updated = await repo.updateReminder(
      db,
      user.id,
      id,
      {
        text: input.text,
        person: input.person,
        due,
        recurrence: input.recurrence,
        acknowledged: input.acknowledged,
      },
      now(),
      user.timezone,
    );
    if (!updated) throw notFound(REMINDER_NOT_FOUND);
    // Keeps the one calendar event for this reminder in step with the edit (never a second event).
    await sync.syncReminder(user.id, id);
    res.json({ reminder: await load(user.id, id) });
  });

  router.delete('/:id', async (req, res) => {
    const userId = currentUser(req).id;
    const id = parseReminderId(req.params.id);
    const eventIds = await sync.eventIdsForReminders(userId, [id]);
    const deleted = await repo.deleteReminder(db, userId, id);
    if (!deleted) throw notFound(REMINDER_NOT_FOUND);
    await sync.removeEvents(userId, eventIds);
    res.status(204).end();
  });

  // ---- notifying another user: only the reminder's owner can manage its shares.

  router.get('/:id/shares', async (req, res) => {
    const list = await shares.listSharesForReminder(
      db,
      currentUser(req).id,
      parseReminderId(req.params.id),
    );
    if (!list) throw notFound(REMINDER_NOT_FOUND);
    res.json({ shares: list });
  });

  router.post('/:id/shares', async (req, res) => {
    const user = currentUser(req);
    const reminderId = parseReminderId(req.params.id);
    const { email } = shareBody.parse(req.body);

    // Ownership first, so a non-owner learns nothing about which accounts exist.
    await load(user.id, reminderId);

    if (!shareLimiter.take(user.id)) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'You are sharing too quickly. Please wait a minute and try again.',
      );
    }

    // The recipient must be a real, verified NoteFlow account: resolved here from the email,
    // never from a name or an id sent by the browser.
    const recipient = await findUserByEmail(db, email);
    if (!recipient || !recipient.emailVerifiedAt) {
      throw new AppError(
        'RECIPIENT_NOT_FOUND',
        404,
        'We could not find a NoteFlow account for that email. They need to sign in to NoteFlow with that Google account first.',
      );
    }
    if (recipient.id === user.id) {
      throw new AppError(
        'CANNOT_SHARE_WITH_SELF',
        422,
        'That is your own account, so this reminder is already yours.',
      );
    }

    const result = await shares.shareReminder(db, user.id, reminderId, recipient.id, now());
    if (result.status === 'not_found') throw notFound(REMINDER_NOT_FOUND);
    if (result.status === 'limit') {
      throw new AppError(
        'SHARE_LIMIT',
        422,
        `A reminder can be shared with at most ${shares.MAX_SHARES_PER_REMINDER} people.`,
      );
    }
    res.status(result.status === 'created' ? 201 : 200).json({ share: result.share });
  });

  router.delete('/:id/shares/:shareId', async (req, res) => {
    const removed = await shares.revokeShare(
      db,
      currentUser(req).id,
      parseReminderId(req.params.id),
      parseShareId(req.params.shareId),
    );
    if (!removed) throw notFound('We could not find that share.');
    res.status(204).end();
  });

  return router;
}
