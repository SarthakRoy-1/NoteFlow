import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import type { AIProvider } from '../../src/ai/provider/index.js';
import type { GoogleAuth, GoogleIdentity, OAuthChecks } from '../../src/auth/google.js';
import { createSession, hashToken } from '../../src/auth/sessions.js';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { parseEnv, type Env } from '../../src/config/env.js';
import { createDb } from '../../src/db/client.js';
import { sessions, users } from '../../src/db/schema.js';
import { loadDotenv } from '../../src/loadDotenv.js';
import { assertSafeTestDatabase } from './safety.js';
import { FakeAI } from './fakeAi.js';

export { FakeAI };
/** Fixed clock for every AI/date test: Thursday 8 Oct 2026, 10:00 UTC. */
export const FIXED_NOW = new Date('2026-10-08T10:00:00Z');

loadDotenv();

export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  const { url } = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  return parseEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef-0123456789',
    DATABASE_URL: url.toString(),
    APP_BASE_URL: 'http://localhost:5173',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/auth/google/callback',
    ...overrides,
  });
}

/** Opens a connection to the *_test database (never the dev database). */
export function openTestDb(env = testEnv()) {
  return createDb(env.DATABASE_URL);
}

export type TestDb = ReturnType<typeof openTestDb>['db'];

/** Remove all rows. Every table references users, so one cascading TRUNCATE clears everything. */
export async function resetDb(db: TestDb) {
  await db.execute(sql`truncate table ${users} restart identity cascade`);
}

export async function createUserWithSession(
  db: TestDb,
  opts: { email?: string; sub?: string; timezone?: string; expiresAt?: Date } = {},
) {
  const email = opts.email ?? 'user@example.com';
  const [user] = await db
    .insert(users)
    .values({
      googleSub: opts.sub ?? `sub-${email}`,
      email,
      name: email.split('@')[0] ?? 'user',
      timezone: opts.timezone ?? 'UTC',
    })
    .returning();
  if (!user) throw new Error('failed to create test user');

  const { token, expiresAt } = await createSession(db, user.id, 14);
  if (opts.expiresAt) {
    // Force a specific expiry (e.g. in the past) for expiry tests.
    await db
      .update(sessions)
      .set({ expiresAt: opts.expiresAt })
      .where(eq(sessions.id, hashToken(token)));
  }
  return { user, token, cookie: `${SESSION_COOKIE}=${token}`, expiresAt };
}

/** Test double for Google. The app code path (cookies, state check, user upsert, session) is real. */
export class FakeGoogle implements GoogleAuth {
  started: OAuthChecks[] = [];
  completed: { url: URL; checks: OAuthChecks }[] = [];
  identity: GoogleIdentity = {
    sub: 'google-sub-1',
    email: 'person@example.com',
    emailVerified: true,
    name: 'Pat Person',
  };
  failWith: Error | undefined;

  async startAuthorization() {
    const checks: OAuthChecks = {
      state: `state-${this.started.length}-${Math.random().toString(36).slice(2)}`,
      codeVerifier: `verifier-${Math.random().toString(36).slice(2)}`,
      nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    };
    this.started.push(checks);
    const url = new URL('https://accounts.example.test/authorize');
    url.searchParams.set('state', checks.state);
    return { url, checks };
  }

  async completeAuthorization(url: URL, checks: OAuthChecks) {
    this.completed.push({ url, checks });
    if (this.failWith) throw this.failWith;
    return this.identity;
  }
}

export function buildApp(
  db: TestDb,
  env = testEnv(),
  google?: FakeGoogle,
  extra: { ai?: AIProvider; now?: () => Date } = {},
) {
  return createApp({
    env,
    db,
    googleFactory: google ? () => google : undefined,
    ai: extra.ai ?? new FakeAI(),
    now: extra.now ?? (() => FIXED_NOW),
  });
}
