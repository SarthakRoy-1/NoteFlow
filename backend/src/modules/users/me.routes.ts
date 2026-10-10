import { Router } from 'express';
import { z } from 'zod';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { reminders } from '../../db/schema.js';
import { isValidIanaTimezone } from '../../lib/timezone.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { toPublicUser, updateTimezone } from './users.repo.js';

// strict(): unknown keys (e.g. a client-supplied user_id) are rejected, never silently honoured.
const patchMeBody = z
  .object({
    timezone: z
      .string()
      .refine(isValidIanaTimezone, 'Timezone must be a valid IANA identifier, e.g. Europe/London'),
  })
  .strict();

export function meRouter(db: Db) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ user: toPublicUser(currentUser(req)) });
  });

  router.patch('/', async (req, res) => {
    const { timezone } = patchMeBody.parse(req.body);
    const user = currentUser(req);
    const updated = await updateTimezone(db, user.id, timezone);
    // Calendar events carry the zone they were sent in: mark them stale so "Sync existing
    // reminders" (or the next edit) re-sends them in the new zone. Nothing is sent from here.
    if (updated.timezone !== user.timezone) {
      await db
        .update(reminders)
        .set({ calendarSyncedAt: null })
        .where(and(eq(reminders.userId, user.id), isNotNull(reminders.googleEventId)));
    }
    res.json({ user: toPublicUser(updated) });
  });

  return router;
}
