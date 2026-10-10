import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

/** `.env.example` ships blank values; a blank must mean "not set", not a validation error. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535).default(3001)),
  APP_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:5173')),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(90).default(14),
  ),
  /** Google sign-in with "Remember me": a persistent cookie and a server session of this length. */
  REMEMBER_ME_TTL_DAYS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(90).default(30),
  ),
  /** Google sign-in without it: a browser-session cookie, and the server also stops honouring it after this. */
  SESSION_ONLY_TTL_HOURS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(72).default(24),
  ),
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => /^postgres(ql)?:\/\//.test(u), 'DATABASE_URL must be a postgres:// URL'),
  TEST_DATABASE_URL: optionalString,
  // Google and Gemini settings are optional at boot so the app can start and report a clear
  // "not configured" error to the user instead of crashing.
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  // Assignment compliance: custom email/password auth is OFF unless explicitly enabled. Only the
  // exact string `true` turns it on; anything else (including unset) leaves it off.
  ENABLE_PASSWORD_AUTH: z.preprocess(
    blankToUndefined,
    z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  ),
  // Transactional email. EMAIL_PROVIDER picks the sender; when unset it is `resend` if
  // RESEND_API_KEY is present. Without a complete provider (see createEmailSender), sign-up by
  // email and password recovery are switched off rather than faked.
  EMAIL_PROVIDER: z.preprocess(blankToUndefined, z.enum(['resend', 'smtp']).optional()),
  EMAIL_FROM: optionalString,
  RESEND_API_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_SECURE: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  // Web Push (VAPID). Generate a pair once with `npx web-push generate-vapid-keys`. All three are
  // needed; with any missing, push is switched off (and says so) rather than half-working.
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  /** A `mailto:` address or https URL the push services can contact. */
  VAPID_SUBJECT: optionalString,
  // Shared secret that lets an external scheduler (cron-job.org, GitHub Actions, Render cron) call
  // POST /api/internal/notifications/dispatch. Unset = that endpoint does not exist.
  NOTIFICATIONS_CRON_SECRET: z.preprocess(
    blankToUndefined,
    z.string().min(32, 'NOTIFICATIONS_CRON_SECRET must be at least 32 characters').optional(),
  ),
  // The in-process poller. Fine as a backstop; it cannot run while a free host is asleep, which is
  // why the external trigger above exists. The delivery ledger makes running both safe.
  NOTIFICATIONS_SCHEDULER: z.preprocess(
    blankToUndefined,
    z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  ),
  NOTIFICATIONS_POLL_SECONDS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(10).max(3600).default(60),
  ),
  // Backend-only. Which provider answers AI requests. When unset: Gemini if it is configured,
  // otherwise Groq if it is. A chosen provider that is incomplete leaves AI off; it never falls
  // back to the other one (that could spend quota or money nobody agreed to).
  AI_PROVIDER: z.preprocess(blankToUndefined, z.enum(['gemini', 'groq']).optional()),
  // The model name is configuration, never hardcoded in application logic.
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
  GROQ_API_KEY: optionalString,
  /** Optional: overrides the default Groq model. */
  GROQ_MODEL: optionalString,
});

export type Env = z.infer<typeof envSchema>;

/** Validate a raw environment object. Throws a readable error listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
