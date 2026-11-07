import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import * as argon2 from 'argon2';
import { Secret, TOTP } from 'otpauth';
export class CryptoRateLimitError extends Error {}

export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const csrfToken = (sessionToken: string) =>
  digest(`csrf:${sessionToken}`);
export function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
let activePasswordWork = 0;
async function passwordWork<T>(work: () => Promise<T>): Promise<T> {
  if (activePasswordWork >= 4) throw new CryptoRateLimitError();
  activePasswordWork++;
  try {
    return await work();
  } finally {
    activePasswordWork--;
  }
}
export const hashPassword = (password: string) =>
  passwordWork(() =>
    argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    }),
  );
export const verifyPassword = (hash: string, password: string) =>
  passwordWork(() => argon2.verify(hash, password));
export function encryptSecret(
  value: string,
  key: string,
  userId: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}
export function decryptSecret(
  value: string,
  key: string,
  userId: string,
): string {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext)
    throw new Error('Invalid encrypted credential');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
export function createTotp(secret: string, email = 'account') {
  return new TOTP({
    issuer: 'GST Billing',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}
export const newTotpSecret = () => new Secret({ size: 20 }).base32;
export function totpCounter(
  secret: string,
  code: string,
  lastCounter: number,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = createTotp(secret).validate({
    token: code,
    timestamp: now,
    window: 1,
  });
  const counter = Math.floor(now / 30000) + (delta ?? 0);
  return delta !== null && counter > lastCounter ? counter : null;
}
