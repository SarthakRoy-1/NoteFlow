import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import type { PasswordAuthLimiters } from '../../src/auth/password.routes.js';
import { EmailDeliveryError, type EmailMessage, type EmailSender } from '../../src/email/types.js';
import { createRateLimiter } from '../../src/lib/rateLimit.js';
import type {
  PushOutcome,
  PushPayload,
  PushSender,
  PushTarget,
} from '../../src/notifications/push.js';
import type { AIProvider } from '../../src/ai/provider/index.js';
import type { GoogleAuth, GoogleIdentity, OAuthChecks } from '../../src/auth/google.js';
import { hashPassword } from '../../src/auth/password.js';
import { createSession, hashToken } from '../../src/auth/sessions.js';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { parseEnv, type Env } from '../../src/config/env.js';
import { createDb } from '../../src/db/client.js';
import { pendingRegistrations, sessions, users } from '../../src/db/schema.js';
import { loadDotenv } from '../../src/loadDotenv.js';
import { assertSafeTestDatabase } from './safety.js';
import { FakeAI } from './fakeAi.js';

export { FakeAI };
export const PASSWORD = 'a long enough password';
/** Opt-in for the (default-off) custom email/password routes; only suites that test them use it. */
export const PASSWORD_AUTH_ON = { ENABLE_PASSWORD_AUTH: 'true' } as const;
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
  // pending_registrations is the one table with no foreign key to users.
  await db.execute(sql`truncate table ${users}, ${pendingRegistrations} restart identity cascade`);
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
      emailVerifiedAt: new Date(),
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

/** A password account (and a session for it). `verified: false` mimics an account from before email verification. */
export async function createPasswordUserWithSession(
  db: TestDb,
  opts: { email?: string; password?: string; verified?: boolean; timezone?: string } = {},
) {
  const email = opts.email ?? 'pat@example.com';
  const [user] = await db
    .insert(users)
    .values({
      email,
      name: email.split('@')[0] ?? 'user',
      timezone: opts.timezone ?? 'UTC',
      passwordHash: await hashPassword(opts.password ?? PASSWORD),
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    })
    .returning();
  if (!user) throw new Error('failed to create test user');
  const { token } = await createSession(db, user.id, 14);
  return { user, token, cookie: `${SESSION_COOKIE}=${token}` };
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

/** Effectively unlimited, so ordinary tests never trip the sign-in limits (rate-limit tests pass their own). */
export function generousAuthLimiters(): PasswordAuthLimiters {
  const limiter = () =>
    createRateLimiter({ limit: 10_000, windowMs: 60_000, now: () => new Date() });
  return {
    register: limiter(),
    loginIp: limiter(),
    loginEmail: limiter(),
    emailSend: limiter(),
    forgotIp: limiter(),
    tokenIp: limiter(),
    tokenAttempts: limiter(),
    link: limiter(),
  };
}

/** Records every message instead of sending it; tests read the one-time link out of the text. */
export class FakeEmail implements EmailSender {
  configured = true;
  sent: EmailMessage[] = [];
  /** Make the next sends fail like a provider outage. */
  failWith: EmailDeliveryError | undefined;

  async send(message: EmailMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }

  to(address: string) {
    return this.sent.filter((m) => m.to === address);
  }

  /** The token in the last link sent to `address`. */
  lastToken(address: string): string {
    const text = this.to(address).at(-1)?.text ?? '';
    const match = /#token=([A-Za-z0-9_-]+)/.exec(text);
    if (!match?.[1]) throw new Error(`no link was emailed to ${address}`);
    return match[1];
  }
}

/** Records pushes instead of contacting a push service. Outcomes can be scripted per endpoint. */
export class FakePush implements PushSender {
  configured = true;
  publicKey: string | null = 'BFakeVapidPublicKey_0123456789';
  sent: {
    target: PushTarget;
    payload: PushPayload;
    options: { topic: string; ttlSeconds: number };
  }[] = [];
  attempts = 0;
  /** Outcome per endpoint; anything unlisted uses `fallback`. */
  outcomes = new Map<string, PushOutcome>();
  fallback: PushOutcome = 'sent';

  async send(
    target: PushTarget,
    payload: PushPayload,
    options: { topic: string; ttlSeconds: number },
  ) {
    this.attempts++;
    const outcome = this.outcomes.get(target.endpoint) ?? this.fallback;
    if (outcome === 'sent') this.sent.push({ target, payload, options });
    return outcome;
  }
}

export function buildApp(
  db: TestDb,
  env = testEnv(),
  google?: FakeGoogle,
  extra: {
    ai?: AIProvider;
    now?: () => Date;
    aiCallsPerMinute?: number;
    writesPerMinute?: number;
    authLimiters?: PasswordAuthLimiters;
    email?: EmailSender;
    push?: PushSender;
  } = {},
) {
  return createApp({
    env,
    db,
    googleFactory: google ? () => google : undefined,
    ai: extra.ai ?? new FakeAI(),
    now: extra.now ?? (() => FIXED_NOW),
    aiCallsPerMinute: extra.aiCallsPerMinute,
    // Effectively unlimited unless a test is about the limit itself.
    writesPerMinute: extra.writesPerMinute ?? 1_000_000,
    authLimiters: extra.authLimiters ?? generousAuthLimiters(),
    email: extra.email ?? new FakeEmail(),
    push: extra.push ?? new FakePush(),
  });
}
