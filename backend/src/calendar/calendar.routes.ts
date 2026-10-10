import { Router } from 'express';
import type { Env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { currentUser } from '../middleware/requireAuth.js';
import { CALENDAR_COOKIE, oauthCookieOptions } from '../auth/cookies.js';
import type { GoogleAuth } from '../auth/google.js';
import type { CalendarSync } from './calendarSync.js';

export interface CalendarRouterDeps {
  env: Env;
  getGoogle: () => GoogleAuth;
  sync: CalendarSync;
  now?: () => Date;
}

const googleConfigured = (env: Env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);

/**
 * Mounted behind requireAuth. Nothing here ever returns a token. Connecting is a separate, explicit
 * consent (never part of sign-in); the Google redirect lands on the existing auth callback.
 */
export function calendarRouter({
  env,
  getGoogle,
  sync,
  now = () => new Date(),
}: CalendarRouterDeps) {
  const router = Router();

  router.get('/status', async (req, res) => {
    res.json(await sync.status(currentUser(req).id, googleConfigured(env)));
  });

  // Returns the Google consent URL; the browser then navigates to it.
  router.post('/connect', async (req, res) => {
    const user = currentUser(req);
    if (!googleConfigured(env) || !sync.available) {
      throw new AppError(
        'CALENDAR_NOT_CONFIGURED',
        503,
        'Google Calendar is not set up on this server.',
      );
    }
    const { url, checks } = await getGoogle().startCalendarAuthorization();
    // Bound to the signed-in user: the callback refuses a grant that arrives under anyone else.
    res.cookie(
      CALENDAR_COOKIE,
      JSON.stringify({ ...checks, userId: user.id }),
      oauthCookieOptions(env),
    );
    res.json({ url: url.toString() });
  });

  // Sends this user's existing reminders (one batch per call; `remaining` says whether to repeat).
  router.post('/sync', async (req, res) => {
    res.json(await sync.syncAll(currentUser(req).id, now()));
  });

  router.post('/disconnect', async (req, res) => {
    await sync.disconnect(currentUser(req).id);
    res.status(204).end();
  });

  return router;
}
