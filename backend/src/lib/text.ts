/**
 * PostgreSQL `text` cannot hold a NUL (U+0000). Rejecting it during validation turns what would be
 * a database error (HTTP 500) into a normal, readable validation failure.
 */
export const hasNul = (value: string): boolean => value.includes('\u0000');

export const noNul = (value: string): boolean => !hasNul(value);

export const NO_NUL_MESSAGE = 'This text contains a character that is not allowed.';
