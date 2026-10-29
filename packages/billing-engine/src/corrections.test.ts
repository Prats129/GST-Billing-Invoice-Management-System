import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { calculateInvoice } from './calculate.js';
import { calculateValueCorrection } from './corrections.js';
import { request, line } from '../testing/fixtures.js';
import { correctionInputSchema } from '@gst/contracts';
const correction = (
  values: { lineId: string; supplyValue: string }[],
  type: 'credit_note' | 'debit_note' = 'credit_note',
) =>
  correctionInputSchema.parse({
    version: 0,
    requestKey: randomUUID(),
    documentType: type,
    issueDate: '2026-10-29',
    reason: 'Synthetic adjustment test',
    lines: values,
  });
test('partial credit and remaining reversal conserve original value and every tax component', () => {
  const original = calculateInvoice(
    request([line({ catalogUnitPrice: '0.03' })]),
  );
  const before = JSON.stringify(original);
  const first = calculateValueCorrection(
    original,
    correction([{ lineId: 'line-a', supplyValue: '0.01' }]),
  );
  const rest = calculateValueCorrection(
    original,
    correction([{ lineId: 'line-a', supplyValue: '0.02' }]),
    [{ documentType: 'credit_note', calculation: first }],
  );
  const paise = (v: string) => BigInt(v.replace('.', ''));
  expect(paise(first.totals.total) + paise(rest.totals.total)).toBe(
    paise(original.totals.total),
  );
  expect(paise(first.totals.cgst) + paise(rest.totals.cgst)).toBe(
    paise(original.totals.cgst),
  );
  expect(paise(first.totals.sgst) + paise(rest.totals.sgst)).toBe(
    paise(original.totals.sgst),
  );
  expect(JSON.stringify(original)).toBe(before);
  expect(() =>
    calculateValueCorrection(
      original,
      correction([{ lineId: 'line-a', supplyValue: '0.03' }]),
      [{ documentType: 'credit_note', calculation: first }],
    ),
  ).toThrow('Credit exceeds');
});
test('debit values use original rates with balanced intra-state components and expand credit capacity', () => {
  const original = calculateInvoice(request([line(), line({ id: 'line-b' })]));
  const debit = calculateValueCorrection(
    original,
    correction(
      [
        { lineId: 'line-a', supplyValue: '0.03' },
        { lineId: 'line-b', supplyValue: '0.03' },
      ],
      'debit_note',
    ),
  );
  expect(debit.totals).toMatchObject({
    taxTotal: '0.02',
    cgst: '0.01',
    sgst: '0.01',
    total: '0.08',
  });
  const credit = calculateValueCorrection(
    original,
    correction([
      { lineId: 'line-a', supplyValue: '100.03' },
      { lineId: 'line-b', supplyValue: '100.03' },
    ]),
    [{ documentType: 'debit_note', calculation: debit }],
  );
  expect(credit.totals.total).toBe('236.08');
  expect(() =>
    calculateValueCorrection(
      original,
      correction([{ lineId: 'unknown', supplyValue: '1' }]),
    ),
  ).toThrow('not on the original');
});
test('hundreds of partial credits preserve aggregate balances without floating point or paise drift', () => {
  const original = calculateInvoice(request());
  const history: {
    documentType: 'credit_note';
    calculation: ReturnType<typeof calculateInvoice>;
  }[] = [];
  for (let i = 0; i < 300; i++)
    history.push({
      documentType: 'credit_note',
      calculation: calculateValueCorrection(
        original,
        correction([{ lineId: 'line-a', supplyValue: '0.01' }]),
        history,
      ),
    });
  const remainder = calculateValueCorrection(
    original,
    correction([{ lineId: 'line-a', supplyValue: '97.00' }]),
    history,
  );
  const total = history.reduce(
    (n, d) => n + BigInt(d.calculation.totals.total.replace('.', '')),
    BigInt(remainder.totals.total.replace('.', '')),
  );
  expect(total).toBe(11800n);
  expect(remainder.totals.supplyValue).toBe('97.00');
});
