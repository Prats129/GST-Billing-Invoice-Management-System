import { expect, test } from 'vitest';
import {
  calculateInvoice,
  roundToNearestRupee,
  BillingCalculationError,
} from './index.js';
import { line, request, revision } from '../testing/fixtures.js';
import { allocatePaise } from './allocation.js';

test.each([
  [
    'exclusive decimal quantity',
    line({ quantity: '2.5' }),
    '250.00',
    '45.00',
    '295.00',
  ],
  [
    'inclusive decimal quantity',
    line({ quantity: '2.5', catalogUnitPrice: '118', priceIncludesGst: true }),
    '250.00',
    '45.00',
    '295.00',
  ],
  [
    'exact 0.1 × 0.2',
    line({ quantity: '0.2', catalogUnitPrice: '0.1' }),
    '0.02',
    '0.00',
    '0.02',
  ],
  [
    'fixed line discount',
    line({ discount: { kind: 'amount', value: '10' } }),
    '90.00',
    '16.20',
    '106.20',
  ],
  [
    'percentage inclusive discount',
    line({
      catalogUnitPrice: '118',
      priceIncludesGst: true,
      discount: { kind: 'percent', value: '10' },
    }),
    '90.00',
    '16.20',
    '106.20',
  ],
  [
    'inclusive fixed discount',
    line({
      catalogUnitPrice: '118',
      priceIncludesGst: true,
      discount: { kind: 'amount', value: '18' },
    }),
    '84.75',
    '15.25',
    '100.00',
  ],
  [
    'percentage exact intermediate',
    line({
      quantity: '3',
      catalogUnitPrice: '199.99',
      discount: { kind: 'percent', value: '10' },
    }),
    '539.97',
    '97.19',
    '637.16',
  ],
  [
    'complete line discount',
    line({ discount: { kind: 'percent', value: '100' } }),
    '0.00',
    '0.00',
    '0.00',
  ],
  [
    'free-priced arithmetic',
    line({ catalogUnitPrice: '0' }),
    '0.00',
    '0.00',
    '0.00',
  ],
])('%s', (_name, item, value, tax, total) => {
  const result = calculateInvoice(request([item]));
  expect(result.totals).toMatchObject({
    supplyValue: value,
    taxTotal: tax,
    total,
  });
  expect(result.policy.issuanceAllowed).toBe(false);
  expect(result.lines[0]!.taxSource.reference).toBe(
    'Synthetic arithmetic test source',
  );
});
test('discount precedes rounding; display discount is the reconciling difference', () => {
  const result = calculateInvoice(
    request([
      line({
        catalogUnitPrice: '1.0050',
        discount: { kind: 'percent', value: '50' },
        taxRevisions: [revision({ category: 'nil', gstPercent: '0.00' })],
      }),
    ]),
  );
  expect(result.lines[0]).toMatchObject({
    pricedSubtotal: '1.01',
    pricedLineDiscount: '0.51',
    pricedAfterLineDiscount: '0.50',
    supplyValue: '0.50',
  });
});
test('invoice fixed discount normalizes mixed pricing modes to exclusive weights', () => {
  const result = calculateInvoice(
    request(
      [
        line({ id: 'a', catalogUnitPrice: '118', priceIncludesGst: true }),
        line({ id: 'b', catalogUnitPrice: '200' }),
      ],
      { invoiceDiscount: { kind: 'amount', value: '10' } },
    ),
  );
  expect(result.lines.map((row) => row.invoiceDiscount)).toEqual([
    '3.33',
    '6.67',
  ]);
  expect(result.lines.map((row) => row.supplyValue)).toEqual([
    '96.67',
    '193.33',
  ]);
  expect(result.totals).toMatchObject({
    exclusiveSubtotal: '300.00',
    invoiceDiscount: '10.00',
    supplyValue: '290.00',
    taxTotal: '52.20',
    total: '342.20',
  });
  expect(result.invoiceDiscountBasis).toBe('tax_exclusive');
});
test('percentage invoice discount spans mixed rates, nil and exempt values distinctly', () => {
  const result = calculateInvoice(
    request(
      [
        line({ id: 'a', taxRevisions: [revision({ gstPercent: '5.00' })] }),
        line({ id: 'b' }),
        line({
          id: 'c',
          catalogUnitPrice: '50',
          taxRevisions: [revision({ gstPercent: '0.00', category: 'nil' })],
        }),
        line({
          id: 'd',
          catalogUnitPrice: '100',
          taxRevisions: [revision({ gstPercent: '0.00', category: 'exempt' })],
        }),
      ],
      { invoiceDiscount: { kind: 'percent', value: '10' } },
    ),
  );
  expect(result.totals).toMatchObject({
    exclusiveSubtotal: '350.00',
    invoiceDiscount: '35.00',
    supplyValue: '315.00',
    taxableValue: '180.00',
    nilRatedValue: '45.00',
    exemptValue: '90.00',
    taxTotal: '20.70',
    total: '335.70',
  });
  expect(result.taxSummary).toHaveLength(4);
  expect(
    result.taxSummary
      .filter((row) => row.category !== 'taxable')
      .every((row) => row.taxComponents.length === 0),
  ).toBe(true);
});
test('inclusive price is preserved without invoice discount; exclusive discount recomputes GST', () => {
  const item = line({
    catalogUnitPrice: '118',
    priceIncludesGst: true,
    discount: { kind: 'amount', value: '18' },
  });
  const result = calculateInvoice(
    request([item], { invoiceDiscount: { kind: 'amount', value: '10' } }),
  );
  expect(result.totals).toMatchObject({
    lineDiscount: '15.25',
    invoiceDiscount: '10.00',
    supplyValue: '74.75',
    taxTotal: '13.46',
    total: '88.21',
  });
});
test('allocation is stable across permutations, skips ineligible lines and never exceeds capacities', () => {
  const input = request(
    ['z', 'b', 'a'].map((id) =>
      line({
        id,
        catalogUnitPrice: '0.01',
        taxRevisions: [revision({ category: 'nil', gstPercent: '0.00' })],
      }),
    ),
    { invoiceDiscount: { kind: 'amount', value: '0.01' } },
  );
  expect(
    calculateInvoice(input).lines.map((row) => [row.id, row.invoiceDiscount]),
  ).toEqual([
    ['z', '0.00'],
    ['b', '0.00'],
    ['a', '0.01'],
  ]);
  input.lines.reverse();
  expect(
    calculateInvoice(input).lines.find((row) => row.id === 'a')!
      .invoiceDiscount,
  ).toBe('0.01');
  input.lines[0]!.invoiceDiscountEligible = false;
  expect(
    calculateInvoice(input).lines.find((row) => row.id === 'a')!
      .invoiceDiscount,
  ).toBe('0.00');
  expect(
    allocatePaise(2n, [
      { key: 'c', weight: 1n },
      { key: 'b', weight: 1n },
      { key: 'a', weight: 1n },
    ]),
  ).toEqual(
    new Map([
      ['c', 0n],
      ['b', 1n],
      ['a', 1n],
    ]),
  );
  expect(() => allocatePaise(4n, [{ key: 'a', weight: 3n }])).toThrow(
    BillingCalculationError,
  );
});
test('odd paise component reconciliation balances the group rather than biasing each line', () => {
  const result = calculateInvoice(
    request(
      ['b', 'a'].map((id) =>
        line({ id, catalogUnitPrice: '0.07', priceIncludesGst: true }),
      ),
    ),
  );
  expect(
    result.lines.map((row) => [
      row.id,
      row.supplyValue,
      row.taxTotal,
      row.total,
    ]),
  ).toEqual([
    ['b', '0.06', '0.01', '0.07'],
    ['a', '0.06', '0.01', '0.07'],
  ]);
  expect(
    result.lines
      .find((row) => row.id === 'a')!
      .taxComponents.map((row) => row.amount),
  ).toEqual(['0.01', '0.00']);
  expect(
    result.lines
      .find((row) => row.id === 'b')!
      .taxComponents.map((row) => row.amount),
  ).toEqual(['0.00', '0.01']);
  expect(result.totals).toMatchObject({
    cgst: '0.01',
    sgst: '0.01',
    taxTotal: '0.02',
    total: '0.14',
  });
});
test('component rates retain half of a two-decimal combined rate without truncation', () => {
  const result = calculateInvoice(
    request([line({ taxRevisions: [revision({ gstPercent: '0.05' })] })]),
  );
  expect(result.lines[0]!.taxComponents).toEqual([
    { kind: 'CGST', ratePercent: '0.025', amount: '0.03' },
    { kind: 'SGST', ratePercent: '0.025', amount: '0.02' },
  ]);
});
test.each([
  ['0.00', '0.00', '0.00'],
  ['1.49', '1.00', '-0.49'],
  ['1.50', '2.00', '0.50'],
  ['1.51', '2.00', '0.49'],
  ['99.99', '100.00', '0.01'],
])('whole-rupee rounding is separate: %s', (input, amount, adjustment) => {
  expect(roundToNearestRupee(input)).toEqual({ amount, adjustment });
});
test('large catalog prices remain exact and overflow is rejected rather than clamped', () => {
  const result = calculateInvoice(
    request([line({ catalogUnitPrice: '99999999999999.9999' })]),
  );
  expect(result.lines[0]!.catalogUnitPrice).toBe('99999999999999.9999');
  expect(result.totals.total).toBe('118000000000000.00');
  expect(() =>
    calculateInvoice(
      request([
        line({
          unitCode: 'OTH',
          quantity: '999999999.999999',
          catalogUnitPrice: '99999999999999.9999',
        }),
      ]),
    ),
  ).toThrow(expect.objectContaining({ code: 'AMOUNT_OVERFLOW' }));
  expect(() => roundToNearestRupee('9999999999999999.99')).toThrow(
    expect.objectContaining({ code: 'AMOUNT_OVERFLOW' }),
  );
});
