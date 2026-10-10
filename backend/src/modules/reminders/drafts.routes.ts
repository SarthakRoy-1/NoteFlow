import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { CalendarSync } from '../../calendar/calendarSync.js';
import type { Db } from '../../db/client.js';
import { resolveDueInput } from '../../lib/dueInput.js';
import { AppError, notFound } from '../../lib/errors.js';
import { NO_NUL_MESSAGE, noNul } from '../../lib/text.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as drafts from './drafts.repo.js';
import * as repo from './reminders.repo.js';
import { REMINDER_PERSON_MAX, REMINDER_TEXT_MAX } from './reminders.schemas.js';

const DRAFT_NOT_FOUND = 'We could not find that pending reminder.';
const uuid = z.string().uuid();

// strict(): nothing but these fields is accepted. The time is mandatory, and there is no way to
// send "no time", "no date" or a date-only value: that is exactly what this route exists to refuse.
const completeBody = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-09.')
      .optional(),
    time: z
      .string({ required_error: 'Choose a time.', invalid_type_error: 'Choose a time.' })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 17:30.'),
    text: z
      .string()
      .trim()
      .min(1, 'Reminder text cannot be empty.')
      .max(REMINDER_TEXT_MAX)
      .refine(noNul, NO_NUL_MESSAGE)
      .optional(),
    person: z
      .string()
      .trim()
      .max(REMINDER_PERSON_MAX)
      .refine(noNul, NO_NUL_MESSAGE)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
  })
  .strict();

export interface DraftsDeps {
  db: Db;
  now: () => Date;
  sync: CalendarSync;
}

/**
 * Reminders the AI found in a note but that still need a valid date and time. Mounted behind
 * requireAuth; every query is scoped to the session's user. Completing one is the ONLY way such an
 * item becomes a reminder, and it requires a real date and time, checked here (the backend is the
 * authority; the browser's checks are only a convenience).
 */
export function reminderDraftsRouter({ db, now, sync }: DraftsDeps) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ drafts: await drafts.listDrafts(db, currentUser(req).id) });
  });

  router.post('/:id/complete', async (req, res) => {
    const user = currentUser(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw notFound(DRAFT_NOT_FOUND);
    const body = completeBody.parse(req.body);

    // The typed local date + time become an instant in the USER's zone (DST-aware).
    const resolved = body.date
      ? resolveDueInput({ date: body.date, time: body.time }, user.timezone, 'start')
      : null;
    const dueAt = resolved?.dueAt ?? null;
    // Reject impossible calendar dates such as 2026-02-30 (Luxon reports them as invalid).
    if (body.date && !DateTime.fromISO(body.date, { zone: user.timezone }).isValid) {
      throw new AppError('VALIDATION_FAILED', 422, 'That is not a valid date.');
    }

    const result = await drafts.completeDraft(
      db,
      user.id,
      id.data,
      { dueAt, time: body.time, text: body.text, person: body.person },
      now(),
      user.timezone,
    );
    if (result.status === 'not_found') throw notFound(DRAFT_NOT_FOUND);
    if (result.status === 'invalid') {
      throw new AppError('VALIDATION_FAILED', 422, result.message);
    }
    // Only now, with the reminder safely stored, is a calendar event created for it.
    await sync.syncReminder(user.id, result.reminderId);
    const reminder = await repo.getReminder(db, user.id, result.reminderId);
    res.status(201).json({ reminder });
  });

  router.delete('/:id', async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw notFound(DRAFT_NOT_FOUND);
    const removed = await drafts.dismissDraft(db, currentUser(req).id, id.data);
    if (!removed) throw notFound(DRAFT_NOT_FOUND);
    res.status(204).end();
  });

  return router;
}
