import * as client from 'openid-client';
import { describe, expect, it } from 'vitest';
import { createGoogleAuth } from '../../src/auth/google.js';
import { parseEnv } from '../../src/config/env.js';

const base = {
  SESSION_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgres://u:p@localhost:5432/d',
};
const configured = parseEnv({
  ...base,
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csecret',
  GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/auth/google/callback',
});

// Offline OIDC configuration so no network discovery happens in tests.
const offlineConfig = async () =>
  new client.Configuration(
    {
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    },
    'cid',
    'csecret',
  );

describe('createGoogleAuth', () => {
  it('throws a controlled AUTH_NOT_CONFIGURED error when credentials are missing', () => {
    const env = parseEnv(base);
    expect(() => createGoogleAuth(env)).toThrowError(/not configured/i);
    try {
      createGoogleAuth(env);
    } catch (err) {
      expect(err).toMatchObject({ code: 'AUTH_NOT_CONFIGURED', status: 503 });
    }
  });

  it('builds an authorization URL with code flow, PKCE S256, state and nonce', async () => {
    const google = createGoogleAuth(configured, offlineConfig);
    const { url, checks } = await google.startAuthorization();
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe('http://localhost:5173/api/auth/google/callback');
    expect(p.get('scope')).toBe('openid email profile');
    expect(p.get('state')).toBe(checks.state);
    expect(p.get('nonce')).toBe(checks.nonce);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe(
      await client.calculatePKCECodeChallenge(checks.codeVerifier),
    );
    // The verifier itself is never sent to Google on the front channel.
    expect(url.toString()).not.toContain(checks.codeVerifier);
  });

  it('generates fresh state, verifier and nonce for every attempt', async () => {
    const google = createGoogleAuth(configured, offlineConfig);
    const a = (await google.startAuthorization()).checks;
    const b = (await google.startAuthorization()).checks;
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('rejects a callback whose state does not match (library-level check)', async () => {
    const google = createGoogleAuth(configured, offlineConfig);
    const { checks } = await google.startAuthorization();
    const cb = new URL('http://localhost:5173/api/auth/google/callback?code=abc&state=WRONG');
    await expect(google.completeAuthorization(cb, checks)).rejects.toThrow();
  });
});
