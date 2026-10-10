import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/** A key derived from the server secret, used for nothing else (HKDF label below). */
function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'noteflow', 'google-calendar-refresh-token', 32));
}

/** AES-256-GCM. Output is "v1.<iv>.<tag>.<ciphertext>" in base64url; a fresh IV every time. */
export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

/** The original token, or null when the value is malformed, tampered with or the secret changed. */
export function decryptToken(blob: string, secret: string): string | null {
  const [version, iv, tag, data] = blob.split('.');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
