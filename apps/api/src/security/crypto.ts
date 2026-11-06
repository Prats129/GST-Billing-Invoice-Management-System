export {
  token,
  digest,
  csrfToken,
  secureEqual,
  encryptSecret,
  decryptSecret,
  createTotp,
  newTotpSecret,
  totpCounter,
} from '@gst/security';
import {
  hashPassword as hash,
  verifyPassword as verify,
  CryptoRateLimitError,
} from '@gst/security';
import { deny } from './errors.js';
async function work<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof CryptoRateLimitError) deny('RATE_LIMITED');
    throw error;
  }
}
export const hashPassword = (value: string) => work(() => hash(value));
export const verifyPassword = (hash: string, value: string) =>
  work(() => verify(hash, value));
