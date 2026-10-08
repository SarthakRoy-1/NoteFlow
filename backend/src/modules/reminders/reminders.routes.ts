import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as repo from './reminders.repo.js';
import {
  parseReminderId,
  REMINDER_NOT_FOUND,
  resolveReminderDue,
  updateReminderBody,
  type ResolvedDue,
} from './reminders.schemas.js';

/**
 * Mounted behind requireAuth. Identity always comes from the session, never from the request.
 * `now` is the server clock (injectable for tests); alert eligibility is always decided here.
 */
export function remindersRouter(db: Db, now: () => Date) {
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
      { text: input.text, person: input.person, due, acknowledged: input.acknowledged },
      now(),
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

  return router;
}
