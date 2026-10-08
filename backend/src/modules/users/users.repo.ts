import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import type { GoogleIdentity } from '../../auth/google.js';

export type User = typeof users.$inferSelect;

/** The only user shape that ever leaves the server. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  timezone: u.timezone,
});

/**
 * Create or refresh the user for a Google identity. Identity is the stable `sub`, never the email.
 * `timezone` is only applied when the user is first created, so it never overwrites a saved choice.
 */
export async function upsertGoogleUser(
  db: Db,
  identity: GoogleIdentity,
  initialTimezone: string,
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      timezone: initialTimezone,
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: { email: identity.email, name: identity.name, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('User upsert returned no row');
  return row;
}

/** Scoped by the authenticated user's id; there is no way to target another user. */
export async function updateTimezone(db: Db, userId: string, timezone: string): Promise<User> {
  const [row] = await db
    .update(users)
    .set({ timezone, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error('User not found while updating timezone');
  return row;
}
