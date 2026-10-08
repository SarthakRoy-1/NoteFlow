export type ErrorCode =
  'BAD_REQUEST' | 'UNAUTHENTICATED' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'INTERNAL';

/** An error whose message is safe to show to the end user. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode | string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (message = 'We could not find that.') =>
  new AppError('NOT_FOUND', 404, message);
