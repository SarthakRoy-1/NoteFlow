import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth on top of SameSite=Lax: a browser-sent Origin on a state-changing request
 * must be our own frontend origin. Requests without an Origin header come from non-browser clients,
 * which cannot ride on a victim's cookies.
 */
export function originCheck(appBaseUrl: string): RequestHandler {
  const allowed = new URL(appBaseUrl).origin;
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin !== undefined && origin !== allowed) {
      return next(
        new AppError('FORBIDDEN_ORIGIN', 403, 'This request was blocked for security reasons.'),
      );
    }
    next();
  };
}
