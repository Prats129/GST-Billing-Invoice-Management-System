import { expect, test } from 'vitest';
import {
  checksum,
  financialYear,
  assertCalculationReleased,
  issuanceBlockers,
} from './policy.js';
test('Indian financial year starts in April and checksums survive JSONB key reordering', () => {
  expect(financialYear('2026-03-31')).toBe('2526');
  expect(financialYear('2026-04-01')).toBe('2627');
  expect(checksum({ b: 2, a: { z: 3, b: [1, 2] } })).toBe(
    checksum({ a: { b: [1, 2], z: 3 }, b: 2 }),
  );
  expect(checksum({ a: ['1', '2'] })).not.toBe(checksum({ a: ['2', '1'] }));
});
test('released ordinary invoices do not unlock corrections, cancellation or e-invoicing', () => {
  expect(() => assertCalculationReleased('invoice')).not.toThrow();
  expect(() => assertCalculationReleased('unsupported')).toThrow(
    'Issuance is blocked',
  );
  for (const type of ['credit_note', 'debit_note'] as const)
    expect(() => assertCalculationReleased(type)).toThrow(
      'Issuance is blocked',
    );
  expect(() => assertCalculationReleased('invoice', 'cancel')).toThrow(
    'Issuance is blocked',
  );
  expect(issuanceBlockers('invoice', 'not_required')).toEqual([]);
  expect(issuanceBlockers('invoice', 'unknown')).toEqual([
    expect.stringContaining('Confirm whether'),
  ]);
  expect(issuanceBlockers('invoice', 'required')).toEqual([
    expect.stringContaining('IRP integration is on hold'),
  ]);
  expect(issuanceBlockers('credit_note', 'not_required')).toEqual([
    expect.stringContaining('not included'),
  ]);
});
