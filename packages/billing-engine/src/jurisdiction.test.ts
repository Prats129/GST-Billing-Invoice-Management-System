import { expect, test } from 'vitest';
import { calculateInvoice } from './index.js';
import { line, request, revision, actorId } from '../testing/fixtures.js';

test.each(['01', '07', '27', '34'])(
  'same-state %s uses SGST, including territories with their own SGST law',
  (state) => {
    const input = request([
      line({ supply: { kind: 'goods_movement', deliveryState: state } }),
    ]);
    input.context.supplierState = state;
    expect(calculateInvoice(input)).toMatchObject({
      taxScheme: 'cgst-sgst',
      totals: { cgst: '9.00', sgst: '9.00', utgst: '0.00', igst: '0.00' },
    });
  },
);
test.each(['04', '26', '31', '35', '38', '97'])(
  'same-territory %s uses UTGST',
  (state) => {
    const input = request([
      line({
        supply: { kind: 'goods_no_movement', goodsLocationState: state },
      }),
    ]);
    input.context.supplierState = state;
    expect(calculateInvoice(input)).toMatchObject({
      taxScheme: 'cgst-utgst',
      totals: { cgst: '9.00', sgst: '0.00', utgst: '9.00', igst: '0.00' },
    });
  },
);
test('goods movement uses actual delivery, not registered recipient location', () => {
  const result = calculateInvoice(
    request([
      line({ supply: { kind: 'goods_movement', deliveryState: '29' } }),
    ]),
  );
  expect(result).toMatchObject({
    placeOfSupplyState: '29',
    taxScheme: 'igst',
    totals: { cgst: '0.00', igst: '18.00', total: '118.00' },
  });
  expect(result.lines[0]!.placeOfSupply.basis).toBe('igst-10-1-a');
});
test.each([
  ['29', '27', '27'],
  ['29', '29', '29'],
  ['29', null, '29'],
  [null, null, '27'],
])(
  'unregistered goods invoice/delivery %s/%s resolves to %s',
  (invoiceAddressState, deliveryAddressState, state) => {
    const input = request([
      line({
        supply: {
          kind: 'goods_unregistered',
          invoiceAddressState,
          deliveryAddressState,
        },
      }),
    ]);
    input.context.recipient = {
      kind: 'unregistered',
      addressOnRecordState: '07',
    };
    const result = calculateInvoice(input);
    expect(result.placeOfSupplyState).toBe(state);
    expect(result.lines[0]!.placeOfSupply.basis).toBe('igst-10-1-ca');
  },
);
test('general services use registered recipient location; unregistered address or supplier fallback', () => {
  const item = line({
    kind: 'service',
    unitCode: 'HRS',
    supply: {
      kind: 'general_service',
      specialRuleApplies: false,
      suppliedThroughEcommerce: false,
    },
    taxRevisions: [revision({ hsnSac: '998313' })],
  });
  const input = request([item]);
  input.context.recipient = { kind: 'registered', locationState: '29' };
  expect(calculateInvoice(input)).toMatchObject({
    placeOfSupplyState: '29',
    taxScheme: 'igst',
  });
  input.context.recipient = {
    kind: 'unregistered',
    addressOnRecordState: '07',
  };
  expect(calculateInvoice(input).placeOfSupplyState).toBe('07');
  input.context.recipient.addressOnRecordState = null;
  expect(calculateInvoice(input).placeOfSupplyState).toBe('27');
});
test('unsupported supply facts cannot be bypassed with a place override', () => {
  const input = request([
    line({
      placeOfSupplyOverride: {
        stateCode: '27',
        reason: 'Explicit override reason',
      },
    }),
  ]);
  input.context.recipient = {
    kind: 'unregistered',
    addressOnRecordState: '27',
  };
  expect(() =>
    calculateInvoice(input, {
      actorId,
      permissions: ['place_of_supply.override'],
    }),
  ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCENARIO' }));
});
test('multiple resolved places require splitting even when both would otherwise use IGST', () => {
  expect(() =>
    calculateInvoice(
      request([
        line({
          id: 'a',
          supply: { kind: 'goods_movement', deliveryState: '29' },
        }),
        line({
          id: 'b',
          supply: { kind: 'goods_movement', deliveryState: '07' },
        }),
      ]),
    ),
  ).toThrow(expect.objectContaining({ code: 'MULTIPLE_PLACES_OF_SUPPLY' }));
});
