import { z } from 'zod';
import { notFound } from '../../lib/errors.js';

export const SHARED_NOT_FOUND = 'We could not find that shared reminder.';

// strict(): only an email is accepted. A recipient id, a user id or a display name is rejected,
// never honoured: the server alone resolves the email to a real account.
export const shareBody = z
  .object({
    email: z
      .string({
        required_error: 'Enter the email address of the person to notify.',
        invalid_type_error: 'The email address must be text.',
      })
      .trim()
      .toLowerCase()
      .min(1, 'Enter the email address of the person to notify.')
      .max(254, 'That email address is too long.')
      .email('Enter a valid email address.'),
  })
  .strict();

// The recipient can only acknowledge. (Removing a share is DELETE.)
export const acknowledgeSharedBody = z.object({ acknowledged: z.literal(true) }).strict();

const uuid = z.string().uuid();

/** A malformed id can never match a share, so it is reported exactly like a missing one. */
export function parseShareId(raw: unknown): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw notFound(SHARED_NOT_FOUND);
  return parsed.data;
}
