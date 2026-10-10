import webpush from 'web-push';
import type { Env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the service worker receives. It carries no reminder text unless the user opted in. */
export interface PushPayload {
  title: string;
  body: string;
  /** A same-origin path to open when the notification is clicked. */
  url: string;
  /** Collapses duplicates on the device. */
  tag: string;
}

/**
 * sent: the push service accepted it. gone: the subscription no longer exists (delete it).
 * rejected: this message or our credentials are refused (retrying will not help).
 * unavailable: a timeout, 429 or 5xx (retry later).
 */
export type PushOutcome = 'sent' | 'gone' | 'rejected' | 'unavailable';

export interface PushSender {
  readonly configured: boolean;
  /** The VAPID public key the browser needs to subscribe, or null when push is off. */
  readonly publicKey: string | null;
  send(
    target: PushTarget,
    payload: PushPayload,
    options: { topic: string; ttlSeconds: number },
  ): Promise<PushOutcome>;
}

export const unconfiguredPushSender: PushSender = {
  configured: false,
  publicKey: null,
  async send() {
    return 'rejected';
  },
};

/**
 * The hosts browsers' push services use. The server POSTs to whatever endpoint a client registers,
 * so an arbitrary URL would let a user make this backend call internal addresses (SSRF). Anything
 * not on a known push service is refused.
 */
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com', // Chrome, Edge, Brave, Opera on desktop and Android
  'push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari and iOS web apps
  'notify.windows.com', // legacy Edge / Windows
];

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

const TIMEOUT_MS = 10_000;

const safeCode = (code: unknown) =>
  typeof code === 'string' && /^[A-Z_]{2,24}$/.test(code) ? code : undefined;

/**
 * The push service's own reason (e.g. "VapidPkHashMismatch", "BadJwtToken") is what tells a
 * misconfigured key from an expired device. Only a short, printable excerpt is kept.
 */
function pushReason(err: unknown): string | undefined {
  const body = (err as { body?: unknown }).body;
  if (typeof body !== 'string') return undefined;
  const text = [...body]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127)
    .join('')
    .slice(0, 160);
  return text || undefined;
}

export class WebPushSender implements PushSender {
  readonly configured = true;

  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  async send(
    target: PushTarget,
    payload: PushPayload,
    options: { topic: string; ttlSeconds: number },
  ): Promise<PushOutcome> {
    if (!isAllowedPushEndpoint(target.endpoint)) return 'gone';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: this.subject,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
          },
          TTL: options.ttlSeconds,
          topic: options.topic,
          urgency: 'high',
          timeout: TIMEOUT_MS,
        },
      );
      return 'sent';
    } catch (err) {
      const status = err instanceof webpush.WebPushError ? err.statusCode : undefined;
      const outcome: PushOutcome =
        status === 404 || status === 410
          ? 'gone'
          : status !== undefined && status >= 400 && status < 500 && status !== 429
            ? 'rejected'
            : 'unavailable';
      logger.warn('Web Push delivery failed', {
        outcome,
        // Host only: the path of a push endpoint is a bearer secret for that device.
        host: new URL(target.endpoint).hostname,
        status,
        code: safeCode((err as { code?: unknown }).code),
        reason: pushReason(err),
        topic: options.topic,
      });
      return outcome;
    }
  }
}

export function createPushSender(env: Env): PushSender {
  const {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: subject,
  } = env;
  if (publicKey && privateKey && subject) {
    if (!/^(mailto:|https:\/\/)/.test(subject)) {
      logger.warn('Web Push is disabled: VAPID_SUBJECT must start with mailto: or https://');
      return unconfiguredPushSender;
    }
    return new WebPushSender(publicKey, privateKey, subject);
  }
  if (publicKey || privateKey || subject) {
    const missing = (
      [
        ['VAPID_PUBLIC_KEY', publicKey],
        ['VAPID_PRIVATE_KEY', privateKey],
        ['VAPID_SUBJECT', subject],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    logger.warn('Web Push is disabled: VAPID settings are incomplete', { missing });
  }
  return unconfiguredPushSender;
}
