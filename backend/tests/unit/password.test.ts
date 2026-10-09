import { describe, expect, it } from 'vitest';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../src/auth/password.js';

describe('password hashing', () => {
  it('produces an Argon2id PHC string, never the plaintext', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(hash).not.toContain('correct horse battery');
  });

  it('uses a fresh salt, so the same password hashes differently each time', async () => {
    expect(await hashPassword('same password 1')).not.toBe(await hashPassword('same password 1'));
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('treats visually identical Unicode forms as the same password (NFKC)', async () => {
    const hash = await hashPassword('café society 99'); // precomposed e-acute
    expect(await verifyPassword(hash, 'café society 99')).toBe(true); // e + combining accent
  });

  it('returns false (does not throw) for a malformed stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
    expect(await verifyPassword('', 'whatever')).toBe(false);
  });

  it('the dummy verification used for unknown emails runs without error', async () => {
    await expect(verifyAgainstDummy('anything at all')).resolves.toBeUndefined();
  });
});
