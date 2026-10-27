import { describe, expect, test } from 'vitest';
import { parseConfig } from './config.js';

const base = { DATABASE_URL: 'postgresql://test:secret@127.0.0.1/test' };
describe('configuration boundary', () => {
  test('uses loopback development defaults', () => {
    expect(parseConfig(base).HOST).toBe('127.0.0.1');
  });
  test.each([
    { PORT: '0' },
    { DATABASE_URL: 'https://example.com' },
    { HOST: '0.0.0.0' },
    { NODE_ENV: 'production' },
    { TLS_KEY_PATH: 'key' },
    { APP_ORIGIN: 'http://localhost/path' },
    { APP_ORIGIN: 'ftp://example.com' },
    { ALLOWED_HOSTS: '*' },
    { ALLOWED_HOSTS: 'user@example.com' },
  ])('rejects unsafe or incomplete config %j', (override) => {
    expect(() => parseConfig({ ...base, ...override })).toThrow();
  });
  test('configuration errors never include secrets', () => {
    try {
      parseConfig({ DATABASE_URL: 'secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('secret-value');
    }
  });
});
