import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { WebPushSender, createPushSender } from '../../src/notifications/push.js';

const base = {
  SESSION_SECRET: 'test-session-secret-0123456789abcdef-0123456789',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
};
const env = (extra: Record<string, string | undefined> = {}) => parseEnv({ ...base, ...extra });

describe('notification environment', () => {
  it('has safe defaults', () => {
    const e = env();
    expect(e.NOTIFICATIONS_SCHEDULER).toBe(true);
    expect(e.NOTIFICATIONS_POLL_SECONDS).toBe(60);
    expect(e.NOTIFICATIONS_CRON_SECRET).toBeUndefined();
    expect(e.REMEMBER_ME_TTL_DAYS).toBe(30);
    expect(e.SESSION_ONLY_TTL_HOURS).toBe(24);
  });

  it('treats the blank values .env.example ships as "not set"', () => {
    const e = env({
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
      NOTIFICATIONS_CRON_SECRET: '',
      NOTIFICATIONS_SCHEDULER: '',
      NOTIFICATIONS_POLL_SECONDS: '',
      REMEMBER_ME_TTL_DAYS: '',
      SESSION_ONLY_TTL_HOURS: '',
    });
    expect(e.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(e.NOTIFICATIONS_CRON_SECRET).toBeUndefined();
    expect(e.NOTIFICATIONS_SCHEDULER).toBe(true);
    expect(e.REMEMBER_ME_TTL_DAYS).toBe(30);
  });

  it('refuses a weak scheduler secret and out-of-range lifetimes', () => {
    expect(() => env({ NOTIFICATIONS_CRON_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => env({ REMEMBER_ME_TTL_DAYS: '0' })).toThrow();
    expect(() => env({ REMEMBER_ME_TTL_DAYS: '400' })).toThrow();
    expect(() => env({ NOTIFICATIONS_POLL_SECONDS: '1' })).toThrow();
  });

  it('can switch the in-process scheduler off', () => {
    expect(env({ NOTIFICATIONS_SCHEDULER: 'false' }).NOTIFICATIONS_SCHEDULER).toBe(false);
  });
});

describe('createPushSender', () => {
  it('is off without VAPID settings', () => {
    const push = createPushSender(env());
    expect(push.configured).toBe(false);
    expect(push.publicKey).toBeNull();
  });

  it('is off, not half-working, when a setting is missing', () => {
    expect(
      createPushSender(env({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })).configured,
    ).toBe(false);
    expect(createPushSender(env({ VAPID_SUBJECT: 'mailto:ops@example.com' })).configured).toBe(
      false,
    );
  });

  it('refuses a subject that is neither mailto: nor https:', () => {
    const push = createPushSender(
      env({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'http://x.test' }),
    );
    expect(push.configured).toBe(false);
  });

  it('is on with all three, and exposes only the public key', () => {
    const push = createPushSender(
      env({
        VAPID_PUBLIC_KEY: 'pub-key',
        VAPID_PRIVATE_KEY: 'private-key',
        VAPID_SUBJECT: 'mailto:ops@example.com',
      }),
    );
    expect(push).toBeInstanceOf(WebPushSender);
    expect(push.configured).toBe(true);
    expect(push.publicKey).toBe('pub-key');
    expect(JSON.stringify(push)).not.toContain('private-key'.toUpperCase());
  });

  it('refuses to contact an endpoint that is not a known push service', async () => {
    const push = new WebPushSender('pub', 'priv', 'mailto:ops@example.com');
    const outcome = await push.send(
      { endpoint: 'https://169.254.169.254/latest', p256dh: 'x', auth: 'y' },
      { title: 't', body: 'b', url: '/reminders', tag: 'x' },
      { topic: 'abc', ttlSeconds: 60 },
    );
    expect(outcome).toBe('gone');
  });
});
