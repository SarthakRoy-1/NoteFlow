import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
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
    const updated = await updateTimezone(db, currentUser(req).id, timezone);
    res.json({ user: toPublicUser(updated) });
  });

  return router;
}
