import { timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { notificationPreferences, pushSubscriptions } from '../db/schema.js';
import type { EmailSender } from '../email/types.js';
import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { currentUser } from '../middleware/requireAuth.js';
import { runDispatch } from './dispatcher.js';
import { isAllowedPushEndpoint, type PushSender } from './push.js';

/** A user's devices beyond this are replaced oldest-first, so the table cannot be filled from one account. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

const base64urlBytes = (length: number) =>
  z
    .string()
    .max(256)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/)
    .refine((v) => Buffer.from(v, 'base64url').length === length, 'Not a valid push key.');

// strict(): a user id, a status or anything else a client invents is rejected, never honoured.
const patchBody = z
  .object({
    emailEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    pushShowText: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');

const subscribeBody = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      .refine(isAllowedPushEndpoint, 'That is not a supported browser push service.'),
    keys: z.object({ p256dh: base64urlBytes(65), auth: base64urlBytes(16) }).strict(),
    label: z.string().max(100).optional(),
  })
  .strict();

/** A label is display text only: control characters are dropped and it is kept short. */
const cleanLabel = (raw: string | undefined) => {
  const printable = [...(raw ?? '')]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('');
  return (printable.replace(/\s+/g, ' ').trim() || 'Browser').slice(0, 60);
};

const uuid = z.string().uuid();

export interface NotificationsDeps {
  db: Db;
  email: EmailSender;
  push: PushSender;
}

async function loadSettings(deps: NotificationsDeps, userId: string) {
  const { db, email, push } = deps;
  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const subs = await db
    .select({
      id: pushSubscriptions.id,
      label: pushSubscriptions.label,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.createdAt));
  return {
    email: { available: email.configured, enabled: prefs?.emailEnabled ?? true },
    push: {
      available: push.configured,
      enabled: prefs?.pushEnabled ?? true,
      showText: prefs?.pushShowText ?? false,
      // The public key is meant to be public; the browser needs it to create a subscription.
      publicKey: push.publicKey,
      subscriptions: subs.map((s) => ({
        id: s.id,
        label: s.label,
        createdAt: s.createdAt.toISOString(),
      })),
    },
  };
}

/** Signed-in user's notification preferences and push devices. Mounted behind requireAuth. */
export function notificationsRouter(deps: NotificationsDeps & { now: () => Date }) {
  const { db, now } = deps;
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await loadSettings(deps, currentUser(req).id));
  });

  router.patch('/', async (req, res) => {
    const userId = currentUser(req).id;
    const changes = patchBody.parse(req.body);
    await db
      .insert(notificationPreferences)
      .values({ userId, ...changes, updatedAt: now() })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...changes, updatedAt: now() },
      });
    res.json(await loadSettings(deps, userId));
  });

  // Creating the same endpoint again refreshes its keys (a browser rotates them), so this is also
  // how a subscription is renewed.
  router.post('/push-subscriptions', async (req, res) => {
    const userId = currentUser(req).id;
    if (!deps.push.configured) {
      throw new AppError(
        'PUSH_NOT_CONFIGURED',
        503,
        'Push notifications are not set up on this server.',
      );
    }
    const body = subscribeBody.parse(req.body);
    const label = cleanLabel(body.label);
    const [row] = await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        label,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // A browser profile belongs to whoever subscribed it last.
        set: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth, label },
      })
      .returning({ id: pushSubscriptions.id });
    if (!row) throw new Error('subscription upsert returned no row');

    const newest = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt), asc(pushSubscriptions.id))
      .limit(MAX_SUBSCRIPTIONS_PER_USER);
    await db.delete(pushSubscriptions).where(
      and(
        eq(pushSubscriptions.userId, userId),
        notInArray(
          pushSubscriptions.id,
          newest.map((n) => n.id),
        ),
      ),
    );
    res.status(201).json({ id: row.id });
  });

  router.delete('/push-subscriptions/:id', async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const removed = id.success
      ? await db
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.id, id.data),
              eq(pushSubscriptions.userId, currentUser(req).id),
            ),
          )
          .returning({ id: pushSubscriptions.id })
      : [];
    if (removed.length === 0) throw notFound('We could not find that device.');
    res.status(204).end();
  });

  return router;
}

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * The trigger an external scheduler calls. It is not a user route: it is guarded by a shared
 * secret, and does nothing but run one dispatch tick (idempotent, so extra calls are harmless).
 */
export function dispatchTrigger(options: {
  secret: string | undefined;
  run: () => ReturnType<typeof runDispatch>;
}): RequestHandler {
  return async (req, res, next) => {
    try {
      const { secret } = options;
      // Not configured: behave like any unknown path.
      if (!secret) return next(notFound('That endpoint does not exist.'));
      const header = req.get('authorization') ?? '';
      const given = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!given || !safeEqual(given, secret)) {
        return next(new AppError('UNAUTHENTICATED', 401, 'Not allowed.'));
      }
      const result = await options.run();
      logger.info('Notification dispatch', { ...result });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}
