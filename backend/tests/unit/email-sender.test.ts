import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { createEmailSender, unconfiguredEmailSender } from '../../src/email/index.js';
import { ResendEmailSender } from '../../src/email/resend.js';
import { SmtpEmailSender, smtpDetail } from '../../src/email/smtp.js';
import { EmailDeliveryError } from '../../src/email/types.js';

const message = {
  to: 'pat@example.com',
  subject: 'Hi',
  text: 'hello https://x.test/#token=secret',
};
const respond = (status: number) =>
  vi.fn(async () => new Response('{"detail":"provider text"}', { status }));

describe('ResendEmailSender', () => {
  it('posts to Resend with the key in a header only', async () => {
    const fetchImpl = respond(200);
    await new ResendEmailSender('re_key', 'NoteFlow <no-reply@example.com>', fetchImpl).send(
      message,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_key');
    expect(String(init.body)).not.toContain('re_key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'NoteFlow <no-reply@example.com>',
      to: ['pat@example.com'],
      subject: 'Hi',
      text: message.text,
    });
  });

  it.each([
    [400, 'rejected'],
    [403, 'rejected'],
    [429, 'unavailable'],
    [500, 'unavailable'],
  ])('maps HTTP %i to %s without leaking the provider response', async (status, kind) => {
    const err = await new ResendEmailSender('re_key', 'a@b.c', respond(status))
      .send(message)
      .catch((e: EmailDeliveryError) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect((err as EmailDeliveryError).kind).toBe(kind);
    expect(String(err)).not.toContain('provider text');
    expect(String(err)).not.toContain('re_key');
    expect(String(err)).not.toContain('secret');
  });

  it('reports a network failure as unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('socket hang up');
    });
    const err = await new ResendEmailSender('k', 'a@b.c', fetchImpl)
      .send(message)
      .catch((e: EmailDeliveryError) => e);
    expect((err as EmailDeliveryError).kind).toBe('unavailable');
  });
});

describe('createEmailSender', () => {
  const base = {
    SESSION_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  };

  it('is not configured without both RESEND_API_KEY and EMAIL_FROM, and refuses to send', async () => {
    for (const extra of [{}, { RESEND_API_KEY: 're_key' }, { EMAIL_FROM: 'a@b.c' }]) {
      const sender = createEmailSender(parseEnv({ ...base, ...extra }));
      expect(sender.configured).toBe(false);
    }
    const err = await unconfiguredEmailSender.send(message).catch((e: EmailDeliveryError) => e);
    expect((err as EmailDeliveryError).kind).toBe('not_configured');
  });

  it('is configured when both are set', () => {
    const sender = createEmailSender(
      parseEnv({ ...base, RESEND_API_KEY: 're_key', EMAIL_FROM: 'NoteFlow <a@b.c>' }),
    );
    expect(sender.configured).toBe(true);
  });
});

describe('SmtpEmailSender', () => {
  const config = {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: 'me@gmail.com',
    pass: 'app-pass-word-1234',
    from: 'me@gmail.com',
  };
  const failing = (err: object) => ({
    sendMail: vi.fn(async () => {
      throw Object.assign(new Error('535 bad app-pass-word-1234'), err);
    }),
  });

  it('hands the message to the transport and never sends real mail', async () => {
    const transport = { sendMail: vi.fn(async () => ({})) };
    await new SmtpEmailSender(config, transport as never).send(message);
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'me@gmail.com',
      to: 'pat@example.com',
      subject: 'Hi',
      text: message.text,
    });
  });

  it.each([
    [{ code: 'EAUTH', responseCode: 535 }, 'rejected'],
    [{ responseCode: 550 }, 'rejected'],
    [{ responseCode: 451 }, 'unavailable'],
    [{ code: 'ETIMEDOUT' }, 'unavailable'],
    [{ code: 'ECONNECTION' }, 'unavailable'],
  ])('maps %j to %s without leaking the server text or credentials', async (cause, kind) => {
    const err = await new SmtpEmailSender(config, failing(cause) as never)
      .send(message)
      .catch((e: EmailDeliveryError) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect((err as EmailDeliveryError).kind).toBe(kind);
    expect(String(err)).not.toContain(config.pass);
    expect(String(err)).not.toContain('secret');
  });
});

describe('createEmailSender with SMTP', () => {
  const base = {
    SESSION_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  };
  const smtp = {
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'me@gmail.com',
    SMTP_PASS: 'app-pass-word-1234',
    EMAIL_FROM: 'me@gmail.com',
  };

  it('is configured when the SMTP settings are complete', () => {
    expect(createEmailSender(parseEnv({ ...base, ...smtp })).configured).toBe(true);
  });

  it('is not configured when no provider is chosen', () => {
    const unchosen = { ...smtp, EMAIL_PROVIDER: undefined };
    expect(createEmailSender(parseEnv({ ...base, ...unchosen })).configured).toBe(false);
  });

  it('stays disabled, not crashing, when the SMTP password is empty', async () => {
    const env = parseEnv({ ...base, ...smtp, SMTP_PASS: '' });
    const sender = createEmailSender(env);
    expect(sender.configured).toBe(false);
    const err = await sender.send(message).catch((e: EmailDeliveryError) => e);
    expect((err as EmailDeliveryError).kind).toBe('not_configured');
  });

  it('rejects an unknown provider and keeps Resend working when chosen explicitly', () => {
    expect(() => parseEnv({ ...base, EMAIL_PROVIDER: 'carrier-pigeon' })).toThrow(/EMAIL_PROVIDER/);
    const env = parseEnv({
      ...base,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_key',
      EMAIL_FROM: 'a@b.c',
    });
    expect(createEmailSender(env).configured).toBe(true);
  });
});

describe('failure diagnostics (safe to log)', () => {
  const failing = async (res: Response) =>
    (await new ResendEmailSender(
      're_key',
      'a@b.c',
      vi.fn(async () => res),
    )
      .send(message)
      .catch((e: EmailDeliveryError) => e)) as EmailDeliveryError;

  it('Resend: keeps the status and error name, never the provider message', async () => {
    const err = await failing(
      new Response(
        JSON.stringify({
          name: 'validation_error',
          message: 'The pat@example.com domain is not verified',
        }),
        { status: 403 },
      ),
    );
    expect(err.detail).toEqual({
      provider: 'resend',
      category: 'provider_rejected',
      status: 403,
      name: 'validation_error',
    });
    expect(JSON.stringify(err.detail)).not.toContain('pat@example.com');
  });

  it('Resend: ignores an error name that is not a plain identifier', async () => {
    const err = await failing(new Response('{"name":"<script>x</script>"}', { status: 500 }));
    expect(err.detail).toEqual({
      provider: 'resend',
      category: 'provider_unavailable',
      status: 500,
    });
  });

  it('Resend: tells a timeout from another network failure', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    const t = await new ResendEmailSender(
      'k',
      'a@b.c',
      vi.fn(async () => Promise.reject(timeout)),
    )
      .send(message)
      .catch((e: EmailDeliveryError) => e);
    expect((t as EmailDeliveryError).detail).toMatchObject({ category: 'timeout' });
    const n = await new ResendEmailSender(
      'k',
      'a@b.c',
      vi.fn(async () => Promise.reject(new TypeError('x'))),
    )
      .send(message)
      .catch((e: EmailDeliveryError) => e);
    expect((n as EmailDeliveryError).detail).toMatchObject({ category: 'network' });
  });

  it.each([
    ['ETIMEDOUT', undefined, 'timeout'],
    ['ECONNREFUSED', undefined, 'connection_refused'],
    ['ENOTFOUND', undefined, 'dns'],
    ['EAUTH', 535, 'auth'],
    [undefined, 421, 'smtp_4xx'],
    [undefined, 550, 'smtp_5xx'],
    ['weird code with spaces', undefined, 'unknown'],
  ])('SMTP: %s / %s is categorised as %s', (code, responseCode, category) => {
    const detail = smtpDetail(code, responseCode);
    expect(detail.provider).toBe('smtp');
    expect(detail.category).toBe(category);
    // An unrecognisable code is dropped rather than logged.
    if (code === 'weird code with spaces') expect(detail.code).toBeUndefined();
  });

  it('SMTP: a send failure carries detail and no server reply text', async () => {
    const transport = {
      sendMail: vi.fn(async () => {
        throw Object.assign(
          new Error('Connection timeout to smtp.example.com for pat@example.com'),
          {
            code: 'ETIMEDOUT',
          },
        );
      }),
    };
    const err = (await new SmtpEmailSender(
      { host: 'h', port: 465, secure: true, user: 'u', pass: 'p', from: 'a@b.c' },
      transport as never,
    )
      .send(message)
      .catch((e: EmailDeliveryError) => e)) as EmailDeliveryError;
    expect(err.kind).toBe('unavailable');
    expect(err.detail).toEqual({ provider: 'smtp', category: 'timeout', code: 'ETIMEDOUT' });
    expect(JSON.stringify(err.detail)).not.toContain('pat@example.com');
  });
});
