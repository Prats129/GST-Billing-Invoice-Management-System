import { expect, test } from 'vitest';
import { parseGrantImport } from './GrantImport.js';

test('grant file parsing preserves signed bytes and bounds ordered histories', () => {
  const envelope = {
    keyId: 'publisher',
    payload: 'AAAA',
    signature: 'a'.repeat(86),
  };
  expect(parseGrantImport(envelope)).toEqual([envelope]);
  expect(parseGrantImport([envelope, envelope])).toEqual([envelope, envelope]);
  expect(() =>
    parseGrantImport(Array.from({ length: 101 }, () => envelope)),
  ).toThrow();
  expect(() =>
    parseGrantImport({ ...envelope, privateKey: 'not accepted' }),
  ).toThrow();
  expect(() => parseGrantImport([])).toThrow();
});
