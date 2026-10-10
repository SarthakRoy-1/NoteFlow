import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('That endpoint does not exist.'));
};

interface DriverError {
  name?: unknown;
  code?: unknown;
  query?: unknown;
  params?: unknown;
  cause?: { code?: unknown } | null;
}

/**
 * What is safe to write to the log for an unexpected error. Drizzle wraps database failures in an
 * error whose message embeds the whole SQL statement AND every bound parameter, i.e. the user's
 * private note text. Those are never logged: only the PostgreSQL error code is kept (it identifies
 * the failure; even driver messages can echo the offending value, so they are not logged either).
 */
export function describeError(err: unknown): Record<string, unknown> {
  const e = (typeof err === 'object' && err !== null ? err : {}) as DriverError;
  if ('query' in e && 'params' in e) {
    return {
      name: 'DatabaseError',
      code: typeof e.cause?.code === 'string' ? e.cause.code : undefined,
    };
  }
  return {
    name: typeof e.name === 'string' ? e.name : undefined,
    code: typeof e.code === 'string' ? e.code : undefined,
  };
}

/** Single place that turns any thrown error into the `{ error: { code, message } }` envelope. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some of the information you sent is not valid.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  // body-parser errors (malformed JSON, payload too large) carry a 4xx status
  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res
      .status(status)
      .json({ error: { code: 'BAD_REQUEST', message: 'The request was not valid.' } });
    return;
  }
  logger.error('Unhandled error', describeError(err));
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' },
  });
};
