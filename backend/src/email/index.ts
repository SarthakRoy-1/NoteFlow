import { logger } from '../lib/logger.js';
import type { Env } from '../config/env.js';
import { ResendEmailSender } from './resend.js';
import { SmtpEmailSender } from './smtp.js';
import { EmailDeliveryError, type EmailSender } from './types.js';

export type { EmailMessage, EmailSender } from './types.js';
export { EmailDeliveryError } from './types.js';

/** Used when no provider is configured: reports it honestly instead of faking a send. */
export const unconfiguredEmailSender: EmailSender = {
  configured: false,
  async send() {
    throw new EmailDeliveryError('not_configured');
  },
};

export function createEmailSender(env: Env): EmailSender {
  const { EMAIL_FROM: from } = env;
  const provider = env.EMAIL_PROVIDER ?? (env.RESEND_API_KEY ? 'resend' : undefined);
  if (provider === 'smtp' && from && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    // Port 465 is implicit TLS; anything else (587) upgrades with STARTTLS.
    const port = env.SMTP_PORT ?? 465;
    const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
    return new SmtpEmailSender({
      host: env.SMTP_HOST,
      port,
      secure,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from,
    });
  }
  if (provider === 'resend' && env.RESEND_API_KEY && from) {
    return new ResendEmailSender(env.RESEND_API_KEY, from);
  }
  if (env.EMAIL_PROVIDER) {
    // Names only, never values: an incomplete provider leaves email switched off, not broken.
    const needed =
      provider === 'smtp'
        ? ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']
        : ['RESEND_API_KEY', 'EMAIL_FROM'];
    const missing = needed.filter((k) => !env[k as keyof Env]);
    logger.warn('Email is disabled: provider settings are incomplete', { provider, missing });
  }
  return unconfiguredEmailSender;
}

/** Names (never values) of settings an explicitly chosen EMAIL_PROVIDER still lacks. */
export function missingEmailSettings(env: Env): string[] {
  const needed: Record<string, (keyof Env)[]> = {
    resend: ['RESEND_API_KEY', 'EMAIL_FROM'],
    smtp: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'],
  };
  return (needed[env.EMAIL_PROVIDER ?? ''] ?? []).filter((key) => !env[key]);
}
