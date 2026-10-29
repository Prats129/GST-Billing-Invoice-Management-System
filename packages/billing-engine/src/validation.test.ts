import { expect, test } from 'vitest';
import {
  calculateInvoice,
  selectTaxRevision,
  BillingCalculationError,
  CALCULATION_RULE_VERSION,
} from './index.js';
import { actorId, line, request, revision } from '../testing/fixtures.js';
const secondId = '00000000-0000-4000-8000-000000000004';
test('effective selection sorts dates then revision; unreviewed current revisions never fall back', () => {
  const first = revision();
  const future = revision({
    id: secondId,
    revision: 2,
    effectiveFrom: '2026-11-01',
    gstPercent: '12.00',
    verifiedAt: null,
    verifiedBy: null,
    reference: null,
  });
  expect(
    selectTaxRevision({ revisions: [future, first], supplyDate: '2026-10-29' })
      .id,
  ).toBe(first.id);
  expect(() =>
    selectTaxRevision({ revisions: [first, future], supplyDate: '2026-11-01' }),
  ).toThrow(expect.objectContaining({ code: 'TAX_NOT_REVIEWED' }));
  const sameDate = revision({ id: secondId, revision: 2, gstPercent: '12.00' });
  expect(
    calculateInvoice(request([line({ taxRevisions: [sameDate, first] })]))
      .lines[0]!.gstPercent,
  ).toBe('12.00');
  expect(() =>
    selectTaxRevision({ revisions: [future], supplyDate: '2026-10-29' }),
  ).toThrow(expect.objectContaining({ code: 'MISSING_TAX_CLASSIFICATION' }));
  expect(() =>
    selectTaxRevision({ revisions: [first, first], supplyDate: '2026-10-29' }),
  ).toThrow(expect.objectContaining({ code: 'INVALID_TAX_HISTORY' }));
});
test('overrides require each explicit capability and preserve provenance', () => {
  const input = request([
    line({
      priceOverride: {
        unitPrice: '200',
        reason: 'Agreed commercial unit price',
      },
      taxOverride: {
        hsnSac: '100630',
        category: 'taxable',
        gstPercent: '12.00',
        effectiveFrom: '2026-10-29',
        reason: 'Transaction-specific classification review',
        sourceReference: 'Synthetic notification reference',
      },
      placeOfSupplyOverride: {
        stateCode: '29',
        reason: 'Reviewed delivery jurisdiction',
      },
    }),
  ]);
  for (const permissions of [
    [],
    ['price.override'],
    ['price.override', 'tax.override'],
  ])
    expect(() => calculateInvoice(input, { actorId, permissions })).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    );
  const result = calculateInvoice(input, {
    actorId,
    permissions: ['price.override', 'tax.override', 'place_of_supply.override'],
  });
  expect(result).toMatchObject({
    taxScheme: 'igst',
    totals: { supplyValue: '200.00', igst: '24.00', total: '224.00' },
  });
  expect(result.overrides.map((row) => row.kind)).toEqual([
    'price.override',
    'tax.override',
    'place_of_supply.override',
  ]);
  expect(
    result.overrides.every(
      (row) => row.actorId === actorId && row.reason.length >= 5,
    ),
  ).toBe(true);
  expect(result.lines[0]!.placeOfSupply).toMatchObject({
    stateCode: '29',
    overridden: true,
  });
  expect(() =>
    calculateInvoice(input, {
      actorId,
      permissions: [
        'price.override',
        'tax.override',
        'place_of_supply.override',
      ],
      spoofed: true,
    }),
  ).toThrow(expect.objectContaining({ code: 'INVALID_AUTHORITY' }));
  input.lines[0]!.taxOverride!.effectiveFrom = '2026-11-01';
  expect(() =>
    calculateInvoice(input, {
      actorId,
      permissions: [
        'price.override',
        'tax.override',
        'place_of_supply.override',
      ],
    }),
  ).toThrow(expect.objectContaining({ code: 'FUTURE_TAX_OVERRIDE' }));
});
test.each([
  0,
  1,
  -1,
  null,
  [],
  {},
  '0',
  '1e3',
  'NaN',
  'Infinity',
  '0.0000000',
  '1000000000',
  '-1',
  '00.1',
])('malformed quantity %j returns a safe domain error', (quantity) => {
  expect(() =>
    calculateInvoice({ ...request(), lines: [{ ...line(), quantity }] }),
  ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});
test.each([
  { unitCode: 'NOS', quantity: '1.000001' },
  { unitCode: 'KGS', quantity: '1.0001' },
  { unitCode: 'HRS', quantity: '1.001' },
  { catalogUnitPrice: 1.25 },
  { catalogUnitPrice: '1e3' },
  { catalogUnitPrice: '1.00001' },
  { supply: { kind: 'bill_to_ship_to', stateCode: '27' } },
  { kind: 'service' },
  { invoiceDiscountEligible: 'true' },
  { taxRevisions: [{ ...revision(), category: 'zero_rated' }] },
  { taxRevisions: [revision({ category: 'nil', gstPercent: '18.00' })] },
  { taxRevisions: [revision({ gstPercent: '100.01' })] },
  { taxRevisions: [revision({ gstPercent: 'garbage' })] },
  { discount: { kind: 'percent', value: '100.01' } },
  { discount: { kind: 'amount', value: '-1' } },
  { taxRevisions: [] },
  { extraCharge: '10' },
])('rejects unsupported or malformed line %#', (override) => {
  expect(() =>
    calculateInvoice({ ...request(), lines: [{ ...line(), ...override }] }),
  ).toThrow(BillingCalculationError);
});
test('versions, dates, IDs, scope and unsupported classification are checked', () => {
  expect(() =>
    calculateInvoice({
      ...request(),
      ruleVersion: `${CALCULATION_RULE_VERSION}-unknown`,
    }),
  ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_RULE_VERSION' }));
  expect(() =>
    calculateInvoice({ ...request(), supplyDate: '2026-10-28' }),
  ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_DATE' }));
  expect(() =>
    calculateInvoice({ ...request(), supplyDate: '2026-02-30' }),
  ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  expect(() => calculateInvoice(request([line(), line()]))).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  );
  for (const supplyScenario of [
    'export',
    'sez',
    'reverse_charge',
    'import',
    'composition',
    'cess',
  ])
    expect(() =>
      calculateInvoice({
        ...request(),
        context: { ...request().context, supplyScenario },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  expect(() =>
    calculateInvoice(
      request([line({ taxRevisions: [revision({ hsnSac: '998313' })] })]),
    ),
  ).toThrow(expect.objectContaining({ code: 'INVALID_CLASSIFICATION' }));
  expect(() =>
    calculateInvoice({
      ...request(),
      context: { ...request().context, independentSupplies: false },
    }),
  ).toThrow(BillingCalculationError);
});
test('excess discounts and missing eligibility fail explicitly; zero discount remains valid', () => {
  expect(() =>
    calculateInvoice(
      request([line({ discount: { kind: 'amount', value: '100.01' } })]),
    ),
  ).toThrow(expect.objectContaining({ code: 'DISCOUNT_EXCEEDS_VALUE' }));
  expect(() =>
    calculateInvoice(
      request([line()], {
        invoiceDiscount: { kind: 'amount', value: '100.01' },
      }),
    ),
  ).toThrow(expect.objectContaining({ code: 'DISCOUNT_EXCEEDS_VALUE' }));
  expect(() =>
    calculateInvoice(
      request([line({ invoiceDiscountEligible: false })], {
        invoiceDiscount: { kind: 'percent', value: '10' },
      }),
    ),
  ).toThrow(expect.objectContaining({ code: 'NO_DISCOUNT_ELIGIBILITY' }));
  expect(
    calculateInvoice(
      request([line({ catalogUnitPrice: '0' })], {
        invoiceDiscount: { kind: 'amount', value: '0' },
      }),
    ).totals.total,
  ).toBe('0.00');
  expect(
    calculateInvoice(
      request([line({ priceIncludesGst: true, catalogUnitPrice: '118' })], {
        invoiceDiscount: { kind: 'percent', value: '100' },
      }),
    ).totals.total,
  ).toBe('0.00');
});
test('line/history bounds reject excessive work', () => {
  expect(() =>
    calculateInvoice(
      request(
        Array.from({ length: 1001 }, (_, index) =>
          line({ id: `line-${index}` }),
        ),
      ),
    ),
  ).toThrow(BillingCalculationError);
  expect(() =>
    calculateInvoice(
      request([
        line({ taxRevisions: Array.from({ length: 101 }, () => revision()) }),
      ]),
    ),
  ).toThrow(BillingCalculationError);
});
test('special/e-commerce services and unreviewed override baselines cannot be enabled by authority', () => {
  const service = line({
    kind: 'service',
    unitCode: 'HRS',
    supply: {
      kind: 'general_service',
      specialRuleApplies: false,
      suppliedThroughEcommerce: false,
    },
    taxRevisions: [revision({ hsnSac: '998313' })],
    placeOfSupplyOverride: {
      stateCode: '29',
      reason: 'Explicit but restricted override',
    },
  });
  const authority = {
    actorId,
    permissions: ['place_of_supply.override', 'tax.override'],
  };
  for (const flags of [
    { specialRuleApplies: true, suppliedThroughEcommerce: false },
    { specialRuleApplies: false, suppliedThroughEcommerce: true },
  ])
    expect(() =>
      calculateInvoice(
        {
          ...request(),
          lines: [
            { ...service, supply: { kind: 'general_service', ...flags } },
          ],
        },
        authority,
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  const unreviewed = request([
    line({
      taxRevisions: [
        revision({ verifiedAt: null, verifiedBy: null, reference: null }),
      ],
      taxOverride: {
        hsnSac: '100630',
        category: 'taxable',
        gstPercent: '12.00',
        effectiveFrom: '2026-10-29',
        reason: 'Cannot bypass required baseline review',
        sourceReference: 'Synthetic review reference',
      },
    }),
  ]);
  expect(() => calculateInvoice(unreviewed, authority)).toThrow(
    expect.objectContaining({ code: 'TAX_NOT_REVIEWED' }),
  );
});
