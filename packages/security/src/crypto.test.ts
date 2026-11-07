import { expect, test } from 'vitest';
import {
  CryptoRateLimitError,
  hashPassword,
  verifyPassword,
} from './crypto.js';

test('password work rejects excess concurrency and releases capacity afterwards', async () => {
  const password = 'Disposable concurrency test password';
  const pending = Array.from({ length: 4 }, () => hashPassword(password));
  await expect(hashPassword(password)).rejects.toBeInstanceOf(
    CryptoRateLimitError,
  );
  const hashes = await Promise.all(pending);
  await expect(verifyPassword(hashes[0]!, password)).resolves.toBe(true);
});
