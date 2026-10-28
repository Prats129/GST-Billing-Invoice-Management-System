import { expect, test } from 'vitest';
import { Secret, TOTP } from 'otpauth';
import {
  decryptSecret,
  digest,
  encryptSecret,
  hashPassword,
  totpCounter,
  verifyPassword,
} from './crypto.js';

test('Argon2id hashes use unique salts and verify without plaintext storage', async () => {
  const password = 'A sufficiently long test password';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  expect(first).toMatch(/^\$argon2id\$v=19\$/);
  expect(
    Object.fromEntries(
      first
        .split('$')[3]!
        .split(',')
        .map((entry) => entry.split('=')),
    ),
  ).toEqual({ m: '19456', t: '2', p: '1' });
  expect(first).not.toBe(second);
  expect(first).not.toContain(password);
  expect(await verifyPassword(first, password)).toBe(true);
  expect(await verifyPassword(first, 'incorrect')).toBe(false);
});
test('authenticated encryption rejects credential substitution and tampering', () => {
  const key = 'ab'.repeat(32);
  const ciphertext = encryptSecret('totp-secret', key, 'user-a');
  expect(decryptSecret(ciphertext, key, 'user-a')).toBe('totp-secret');
  expect(() => decryptSecret(ciphertext, key, 'user-b')).toThrow();
  expect(() => decryptSecret(ciphertext, 'cd'.repeat(32), 'user-a')).toThrow();
});
test('TOTP RFC6238 SHA1 vector and replay rejection', () => {
  const secret = Secret.fromUTF8('12345678901234567890');
  const otp = new TOTP({ secret, algorithm: 'SHA1', digits: 8, period: 30 });
  expect(otp.generate({ timestamp: 59000 })).toBe('94287082');
  const six = new TOTP({
    secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp: 59000 });
  expect(totpCounter(secret.base32, six, -1, 59000)).toBe(1);
  expect(totpCounter(secret.base32, six, 1, 59000)).toBeNull();
  expect(totpCounter(secret.base32, 'invalid', -1, 59000)).toBeNull();
  expect(digest('token')).toHaveLength(64);
});
