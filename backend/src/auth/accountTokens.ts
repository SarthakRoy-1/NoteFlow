import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  oauthLinkAttempts,
  pendingRegistrations,
  userTokens,
  users,
  sessions,
} from '../db/schema.js';
import { isUniqueViolation, type User } from '../modules/users/users.repo.js';
import { hashToken } from './sessions.js';

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const LINK_TTL_MS = 10 * 60 * 1000;

/** 256 random bits. Only `hash` is ever stored; `token` goes into the email link and nowhere else. */
export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export type TokenLookup<T> =
  { state: 'ok'; value: T } | { state: 'expired' } | { state: 'invalid' };

export type PendingRegistration = typeof pendingRegistrations.$inferSelect;

const lowerEmail = (email: string) =>
  sql`lower(${pendingRegistrations.email}) = ${email.toLowerCase()}`;

/**
 * Remove everything that can no longer be used: expired pending sign-ups, expired or spent tokens,
 * and expired or spent link attempts. Safe to call at any time; it never touches accounts.
 */
export async function purgeExpired(db: Db, now: Date): Promise<void> {
  await db.delete(pendingRegistrations).where(lt(pendingRegistrations.expiresAt, now));
  await db
    .delete(userTokens)
    .where(or(lt(userTokens.expiresAt, now), isNotNull(userTokens.usedAt)));
  await db
    .delete(oauthLinkAttempts)
    .where(or(lt(oauthLinkAttempts.expiresAt, now), isNotNull(oauthLinkAttempts.usedAt)));
}

/** Latest sign-up for an address wins. Returns false if a parallel request took the slot. */
export async function savePending(
  db: Db,
  input: {
    email: string;
    name: string;
    passwordHash: string;
    timezone: string;
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(pendingRegistrations).where(lowerEmail(input.email));
      await tx.insert(pendingRegistrations).values(input);
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

/** Gives an existing, unexpired pending sign-up a fresh token and lifetime (for "resend"). */
export async function rotatePendingToken(
  db: Db,
  email: string,
  tokenHash: string,
  now: Date,
  expiresAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(pendingRegistrations)
    .set({ tokenHash, expiresAt })
    .where(and(lowerEmail(email), sql`${pendingRegistrations.expiresAt} > ${now}`))
    .returning({ id: pendingRegistrations.id });
  return rows.length > 0;
}

export async function findPending(
  db: Db,
  tokenHash: string,
  now: Date,
): Promise<TokenLookup<PendingRegistration>> {
  const [row] = await db
    .select()
    .from(pendingRegistrations)
    .where(eq(pendingRegistrations.tokenHash, tokenHash))
    .limit(1);
  if (!row) return { state: 'invalid' };
  if (row.expiresAt <= now) return { state: 'expired' };
  return { state: 'ok', value: row };
}

/**
 * Turn a pending sign-up into a real, verified account, atomically. The pending row is deleted in
 * the same transaction, so a second use of the same link finds nothing. Returns null if it was
 * already used; throws a unique violation if a real account has taken the address meanwhile.
 */
export async function completePending(
  db: Db,
  pending: PendingRegistration,
  now: Date,
): Promise<User | null> {
  return db.transaction(async (tx) => {
    const gone = await tx
      .delete(pendingRegistrations)
      .where(
        and(
          eq(pendingRegistrations.id, pending.id),
          sql`${pendingRegistrations.expiresAt} > ${now}`,
        ),
      )
      .returning({ id: pendingRegistrations.id });
    if (gone.length === 0) return null;
    const [user] = await tx
      .insert(users)
      .values({
        email: pending.email,
        name: pending.name,
        passwordHash: pending.passwordHash,
        timezone: pending.timezone,
        emailVerifiedAt: now,
      })
      .returning();
    return user ?? null;
  });
}

/** A new account for an address makes any still-pending sign-up for it pointless. */
export async function deletePendingForEmail(db: Db, email: string): Promise<void> {
  await db.delete(pendingRegistrations).where(lowerEmail(email));
}

/** Replaces any unused token of the same purpose, so only the newest emailed link works. */
export async function createUserToken(
  db: Db,
  userId: string,
  purpose: 'verify_email' | 'reset_password',
  tokenHash: string,
  now: Date,
  expiresAt: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(userTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(userTokens.userId, userId),
          eq(userTokens.purpose, purpose),
          isNull(userTokens.usedAt),
        ),
      );
    await tx.insert(userTokens).values({ userId, purpose, tokenHash, expiresAt });
  });
}

export interface UserTokenRef {
  id: string;
  userId: string;
}

export async function findUserToken(
  db: Db,
  purpose: 'verify_email' | 'reset_password',
  tokenHash: string,
  now: Date,
): Promise<TokenLookup<UserTokenRef>> {
  const [row] = await db
    .select()
    .from(userTokens)
    .where(and(eq(userTokens.tokenHash, tokenHash), eq(userTokens.purpose, purpose)))
    .limit(1);
  if (!row || row.usedAt) return { state: 'invalid' };
  if (row.expiresAt <= now) return { state: 'expired' };
  return { state: 'ok', value: { id: row.id, userId: row.userId } };
}

/** Single use: exactly one caller can flip `used_at`, however many race for it. */
export async function consumeUserToken(db: Db, tokenId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(userTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(userTokens.id, tokenId),
        isNull(userTokens.usedAt),
        sql`${userTokens.expiresAt} > ${now}`,
      ),
    )
    .returning({ id: userTokens.id });
  return rows.length > 0;
}

export async function createLinkAttempt(
  db: Db,
  input: {
    stateHash: string;
    userId: string;
    sessionId: string;
    codeVerifier: string;
    nonce: string;
    expiresAt: Date;
  },
): Promise<void> {
  await db.insert(oauthLinkAttempts).values(input);
}

export type LinkAttempt = typeof oauthLinkAttempts.$inferSelect;

/** The OAuth state is one-time: the first callback consumes it, a replay finds it spent. */
export async function consumeLinkAttempt(
  db: Db,
  stateHash: string,
  now: Date,
): Promise<TokenLookup<LinkAttempt> | null> {
  const [row] = await db
    .select()
    .from(oauthLinkAttempts)
    .where(eq(oauthLinkAttempts.stateHash, stateHash))
    .limit(1);
  if (!row) return null; // not a link attempt at all (e.g. a normal sign-in callback)
  if (row.usedAt) return { state: 'invalid' };
  const taken = await db
    .update(oauthLinkAttempts)
    .set({ usedAt: now })
    .where(and(eq(oauthLinkAttempts.stateHash, stateHash), isNull(oauthLinkAttempts.usedAt)))
    .returning();
  if (taken.length === 0) return { state: 'invalid' };
  if (row.expiresAt <= now) return { state: 'expired' };
  return { state: 'ok', value: row };
}

/** Sign the account out everywhere (used after a password reset). */
export async function deleteAllSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
