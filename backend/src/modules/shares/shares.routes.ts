import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as repo from './shares.repo.js';
import { SHARED_NOT_FOUND, acknowledgeSharedBody, parseShareId } from './shares.schemas.js';

export interface SharedRemindersDeps {
  db: Db;
  now: () => Date;
}

/**
 * Reminders other people shared with the signed-in user. Mounted behind requireAuth; the recipient
 * is always the session user, and every query is keyed by that id, so a share id belonging to
 * someone else is indistinguishable from one that does not exist.
 */
export function sharedRemindersRouter({ db, now }: SharedRemindersDeps) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await repo.listSharedWithMe(db, currentUser(req).id, now()));
  });

  router.patch('/:id', async (req, res) => {
    const user = currentUser(req);
    const id = parseShareId(req.params.id);
    acknowledgeSharedBody.parse(req.body);
    if (!(await repo.acknowledgeShared(db, user.id, id, now()))) throw notFound(SHARED_NOT_FOUND);
    const { shared } = await repo.listSharedWithMe(db, user.id, now());
    const item = shared.find((s) => s.id === id);
    if (!item) throw notFound(SHARED_NOT_FOUND);
    res.json({ shared: item });
  });

  router.delete('/:id', async (req, res) => {
    const removed = await repo.removeSharedWithMe(
      db,
      currentUser(req).id,
      parseShareId(req.params.id),
    );
    if (!removed) throw notFound(SHARED_NOT_FOUND);
    res.status(204).end();
  });

  return router;
}
