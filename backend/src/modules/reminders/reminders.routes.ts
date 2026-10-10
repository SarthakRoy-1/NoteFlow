import { Router } from 'express';
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
}

/**
 * Mounted behind requireAuth. Identity always comes from the session, never from the request.
 */
export function remindersRouter({ db, now, shareLimiter }: RemindersDeps) {
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

    // The due date is interpreted in the user's own timezone, taken from their account.
    let due: ResolvedDue | undefined;
    if (input.due === null) {
      due = { dueAt: null, dueHasTime: false };
    } else if (input.due !== undefined) {
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
    res.json({ reminder: await load(user.id, id) });
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await repo.deleteReminder(
      db,
      currentUser(req).id,
      parseReminderId(req.params.id),
    );
    if (!deleted) throw notFound(REMINDER_NOT_FOUND);
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
