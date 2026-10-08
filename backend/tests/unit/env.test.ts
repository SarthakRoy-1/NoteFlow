import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const valid = {
  SESSION_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgres://user:pass@localhost:5432/noteflow',
};

describe('parseEnv', () => {
  it('applies defaults and treats blank optional values as undefined', () => {
    const env = parseEnv({ ...valid, ANTHROPIC_API_KEY: '', GOOGLE_CLIENT_ID: '  ' });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
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
