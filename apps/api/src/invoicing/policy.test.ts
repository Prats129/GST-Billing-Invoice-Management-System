import { expect, test } from 'vitest';
import {
  checksum,
  financialYear,
  assertCalculationReleased,
} from './policy.js';
test('Indian financial year starts in April and checksums survive JSONB key reordering', () => {
  expect(financialYear('2026-03-31')).toBe('2526');
  expect(financialYear('2026-04-01')).toBe('2627');
  expect(checksum({ b: 2, a: { z: 3, b: [1, 2] } })).toBe(
    checksum({ a: { b: [1, 2], z: 3 }, b: 2 }),
  );
  expect(checksum({ a: ['1', '2'] })).not.toBe(checksum({ a: ['2', '1'] }));
});
test('production policy has no issuance bypass', () => {
  expect(() => assertCalculationReleased()).toThrow('Issuance is blocked');
});
