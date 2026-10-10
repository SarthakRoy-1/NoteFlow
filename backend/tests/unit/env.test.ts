import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const valid = {
  SESSION_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgres://user:pass@localhost:5432/noteflow',
};

describe('parseEnv', () => {
  it('applies defaults and treats blank optional values as undefined', () => {
    const env = parseEnv({ ...valid, GEMINI_API_KEY: '', GOOGLE_CLIENT_ID: '  ' });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('reads the Gemini key and model from the environment, with no hardcoded model default', () => {
    const configured = parseEnv({ ...valid, GEMINI_API_KEY: 'k', GEMINI_MODEL: 'some-model' });
    expect(configured.GEMINI_API_KEY).toBe('k');
    expect(configured.GEMINI_MODEL).toBe('some-model');
    expect(parseEnv(valid).GEMINI_MODEL).toBeUndefined();
  });

  it('rejects a short session secret and a missing database url, listing both', () => {
    expect(() => parseEnv({ SESSION_SECRET: 'short' })).toThrowError(
      /SESSION_SECRET[\s\S]*DATABASE_URL/,
    );
  });

  it('rejects an invalid port', () => {
    expect(() => parseEnv({ ...valid, PORT: '70000' })).toThrowError(/PORT/);
  });
});

describe('.env.example', () => {
  it('loads once only the required secrets are filled in (blank optional values are "not set")', () => {
    const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const example = Object.fromEntries(
      text
        .split(/[\r\n]+/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    // Every key in the example is blank except these two, which the owner must fill in.
    const env = parseEnv({ ...example, ...valid });
    expect(env.EMAIL_PROVIDER).toBeUndefined();
    expect(env.SMTP_PORT).toBeUndefined();
    expect(env.SMTP_SECURE).toBeUndefined();
  });

  it('still rejects a wrong provider name, a bad port and a bad secure flag', () => {
    expect(() => parseEnv({ ...valid, EMAIL_PROVIDER: 'pigeon' })).toThrow(/EMAIL_PROVIDER/);
    expect(() => parseEnv({ ...valid, SMTP_PORT: '99999' })).toThrow(/SMTP_PORT/);
    expect(() => parseEnv({ ...valid, SMTP_SECURE: 'yes' })).toThrow(/SMTP_SECURE/);
  });
});
