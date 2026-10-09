import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
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
  // Transactional email. EMAIL_PROVIDER picks the sender; when unset it is `resend` if
  // RESEND_API_KEY is present. Without a complete provider (see createEmailSender), sign-up by
  // email and password recovery are switched off rather than faked.
  EMAIL_PROVIDER: z.enum(['resend', 'smtp']).optional(),
  EMAIL_FROM: optionalString,
  RESEND_API_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  // Backend-only. The model name is configuration, never hardcoded in application logic.
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
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
