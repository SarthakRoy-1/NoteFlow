import * as client from 'openid-client';
import type { Env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Values we must remember between redirecting to Google and handling the callback. */
export interface OAuthChecks {
  state: string;
  codeVerifier: string;
  nonce: string;
}

export interface GoogleAuth {
  startAuthorization(): Promise<{ url: URL; checks: OAuthChecks }>;
  completeAuthorization(callbackUrl: URL, checks: OAuthChecks): Promise<GoogleIdentity>;
}

const GOOGLE_ISSUER = new URL('https://accounts.google.com');

export function authNotConfigured() {
  return new AppError(
    'AUTH_NOT_CONFIGURED',
    503,
    'Google sign-in is not configured on this server. Ask the administrator to set the Google OAuth credentials.',
  );
}

type ConfigLoader = () => Promise<client.Configuration>;

/**
 * Real Google OIDC implementation: authorization code flow + PKCE (S256) + state + nonce.
 * `loadConfig` is injectable so tests can avoid the network discovery call.
 */
export function createGoogleAuth(env: Env, loadConfig?: ConfigLoader): GoogleAuth {
  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: secret,
    GOOGLE_REDIRECT_URI: redirectUri,
  } = env;
  if (!clientId || !secret || !redirectUri) throw authNotConfigured();

  let cached: Promise<client.Configuration> | undefined;
  const getConfig: ConfigLoader =
    loadConfig ??
    (() => {
      cached ??= client.discovery(GOOGLE_ISSUER, clientId, secret).catch((err) => {
        cached = undefined; // allow a retry on the next request
        throw err;
      });
      return cached;
    });

  return {
    async startAuthorization() {
      const config = await getConfig();
      const checks: OAuthChecks = {
        state: client.randomState(),
        codeVerifier: client.randomPKCECodeVerifier(),
        nonce: client.randomNonce(),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(checks.codeVerifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url, checks };
    },

    async completeAuthorization(callbackUrl, checks) {
      const config = await getConfig();
      // openid-client verifies state, PKCE, nonce, and the ID token's issuer/audience/expiry.
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.email !== 'string') {
        throw new Error('Google ID token did not contain an email claim');
      }
      return {
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' && claims.name ? claims.name : claims.email,
      };
    },
  };
}
