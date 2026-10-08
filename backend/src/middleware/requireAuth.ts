import type { RequestHandler } from 'express';
import { SESSION_COOKIE } from '../auth/cookies.js';
import { findUserByToken } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import { AppError } from '../lib/errors.js';

const unauthenticated = () => new AppError('UNAUTHENTICATED', 401, 'Please sign in to continue.');

/** Resolves the session cookie to a user and attaches it as `req.user`, or responds 401. */
export function requireAuth(db: Db): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token: unknown = req.cookies?.[SESSION_COOKIE];
      if (typeof token !== 'string' || token === '') throw unauthenticated();
      const user = await findUserByToken(db, token);
      if (!user) throw unauthenticated();
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** For handlers behind requireAuth: returns the user or fails loudly if wiring is wrong. */
export function currentUser(req: Express.Request) {
  if (!req.user) throw unauthenticated();
  return req.user;
}
