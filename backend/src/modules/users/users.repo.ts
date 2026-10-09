import { and, eq, isNull, sql } from 'drizzle-orm';
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
  /** Which ways this account can sign in. Booleans only: never the hash or the Google id. */
  signIn: { password: boolean; google: boolean };
}

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  timezone: u.timezone,
  signIn: { password: u.passwordHash !== null, google: u.googleSub !== null },
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
      emailVerifiedAt: new Date(), // the caller has already required a Google-verified email
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

/** Emails are compared case-insensitively (matches the unique index on lower(email)). */
export async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

export async function findUserByGoogleSub(db: Db, sub: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.googleSub, sub)).limit(1);
  return row ?? null;
}

export async function findUserById(db: Db, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function setPasswordHash(db: Db, userId: string, passwordHash: string, now: Date) {
  await db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
}

/** Proving an emailed link or reset proves control of the address. */
export async function markEmailVerified(db: Db, userId: string, now: Date) {
  await db
    .update(users)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

/**
 * Attach a Google identity to exactly one account that has none yet. Returns false if that account
 * already has one; throws a unique violation if the identity belongs to another account.
 */
export async function linkGoogleIdentity(
  db: Db,
  userId: string,
  googleSub: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ googleSub, updatedAt: now })
    .where(and(eq(users.id, userId), isNull(users.googleSub)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** True for a PostgreSQL unique_violation, whether the driver wraps it (`cause`) or not. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
