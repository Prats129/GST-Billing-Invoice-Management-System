import { expect, test } from 'vitest';
import { logoDataSchema } from './logo.js';
export const logo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('logo boundary accepts a small PNG and rejects active/remote/oversized content', () => {
  expect(logoDataSchema.safeParse(logo).success).toBe(true);
  expect(logoDataSchema.safeParse('').success).toBe(true);
  for (const value of [
    'https://example.test/logo.png',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    'javascript:alert(1)',
    'data:image/png;base64,' + 'A'.repeat(90000),
    'data:image/png;base64,aGVsbG8=',
  ])
    expect(logoDataSchema.safeParse(value).success).toBe(false);
  const bytes = Buffer.from(logo.slice(22), 'base64');
  bytes.writeUInt32BE(100000, 16);
  expect(
    logoDataSchema.safeParse(
      'data:image/png;base64,' + bytes.toString('base64'),
    ).success,
  ).toBe(false);
});
