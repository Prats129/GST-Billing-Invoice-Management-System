import { expect, test } from 'vitest';
import type { CalculationResult } from './types.js';
import { calculateInvoice } from './index.js';
import { line, request, revision } from '../testing/fixtures.js';
const cents = (value: string) => BigInt(value.replace('.', ''));
const sum = (values: string[]) =>
  values.reduce((total, value) => total + cents(value), 0n);
function reconcile(result: CalculationResult) {
  for (const row of result.lines) {
    expect(cents(row.pricedSubtotal) - cents(row.pricedLineDiscount)).toBe(
      cents(row.pricedAfterLineDiscount),
    );
    expect(
      cents(row.exclusiveSubtotal) -
        cents(row.exclusiveLineDiscount) -
        cents(row.invoiceDiscount),
    ).toBe(cents(row.supplyValue));
    expect(sum(row.taxComponents.map((tax) => tax.amount))).toBe(
      cents(row.taxTotal),
    );
    expect(cents(row.supplyValue) + cents(row.taxTotal)).toBe(cents(row.total));
    expect(
      cents(row.invoiceDiscount) >= 0n && cents(row.supplyValue) >= 0n,
    ).toBe(true);
  }
  const total = result.totals;
  expect(
    cents(total.exclusiveSubtotal) -
      cents(total.lineDiscount) -
      cents(total.invoiceDiscount),
  ).toBe(cents(total.supplyValue));
  expect(
    cents(total.taxableValue) +
      cents(total.nilRatedValue) +
      cents(total.exemptValue),
  ).toBe(cents(total.supplyValue));
  expect(sum([total.cgst, total.sgst, total.utgst, total.igst])).toBe(
    cents(total.taxTotal),
  );
  expect(cents(total.supplyValue) + cents(total.taxTotal)).toBe(
    cents(total.total),
  );
  expect(sum(result.lines.map((row) => row.invoiceDiscount))).toBe(
    cents(total.invoiceDiscount),
  );
  expect(sum(result.lines.map((row) => row.total))).toBe(cents(total.total));
  expect(sum(result.taxSummary.map((row) => row.total))).toBe(
    cents(total.total),
  );
  for (const group of result.taxSummary) {
    const lines = result.lines.filter(
      (row) =>
        row.category === group.category && row.gstPercent === group.gstPercent,
    );
    expect(sum(lines.map((row) => row.supplyValue))).toBe(
      cents(group.supplyValue),
    );
    expect(sum(lines.map((row) => row.taxTotal))).toBe(cents(group.taxTotal));
    if (group.taxComponents.length === 2) {
      const difference =
        cents(group.taxComponents[0]!.amount) -
        cents(group.taxComponents[1]!.amount);
      expect(difference >= 0n && difference <= 1n).toBe(true);
    }
    for (const component of group.taxComponents)
      expect(
        sum(
          lines.flatMap((row) =>
            row.taxComponents
              .filter((tax) => tax.kind === component.kind)
              .map((tax) => tax.amount),
          ),
        ),
      ).toBe(cents(component.amount));
  }
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
test('seeded generated carts reconcile, remain deterministic and do not depend on row order', () => {
  let seed = 0x13579bdf;
  const next = (maximum: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % maximum;
  };
  for (let iteration = 0; iteration < 300; iteration++) {
    const lines = Array.from({ length: next(12) + 1 }, (_, index) => {
      const category = (['taxable', 'nil', 'exempt'] as const)[next(3)]!;
      return line({
        id: `item-${String(index).padStart(4, '0')}`,
        unitCode: 'OTH',
        quantity: `${next(50) + 1}.${String(next(1000000)).padStart(6, '0')}`,
        catalogUnitPrice: `${next(5000) + 1}.${String(next(10000)).padStart(4, '0')}`,
        priceIncludesGst: next(2) === 1,
        invoiceDiscountEligible: index === 0 || next(2) === 1,
        discount: { kind: 'percent', value: String(next(51)) },
        taxRevisions: [
          revision({
            category,
            gstPercent:
              category === 'taxable'
                ? ['5.00', '12.00', '18.00', '28.00'][next(4)]!
                : '0.00',
          }),
        ],
      });
    });
    const input = request(lines, {
      invoiceDiscount: { kind: 'percent', value: String(next(101)) },
    });
    if (iteration % 3 === 0) input.context.supplierState = '29';
    if (iteration % 3 === 1) {
      input.context.supplierState = '38';
      input.lines.forEach((row) => {
        row.supply = { kind: 'goods_movement', deliveryState: '38' };
      });
    }
    const snapshot = JSON.stringify(input);
    deepFreeze(input);
    const result = calculateInvoice(input);
    reconcile(result);
    expect(calculateInvoice(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(snapshot);
    const permuted = calculateInvoice({
      ...input,
      lines: [...input.lines].reverse(),
    });
    expect(permuted.totals).toEqual(result.totals);
    expect(permuted.taxSummary).toEqual(result.taxSummary);
    expect(
      [...permuted.lines].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([...result.lines].sort((a, b) => a.id.localeCompare(b.id)));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  }
});
test('maximum supported cart is bounded and reconciles across 1000 lines', () => {
  const result = calculateInvoice(
    deepFreeze(
      request(
        Array.from({ length: 1000 }, (_, index) =>
          line({ id: `line-${index}` }),
        ),
        { invoiceDiscount: { kind: 'amount', value: '1234.56' } },
      ),
    ),
  );
  expect(result.lines).toHaveLength(1000);
  expect(result.totals).toMatchObject({
    exclusiveSubtotal: '100000.00',
    invoiceDiscount: '1234.56',
    supplyValue: '98765.44',
  });
  reconcile(result);
});
