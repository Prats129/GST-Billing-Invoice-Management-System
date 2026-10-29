import { calculationMoneySchema, correctionInputSchema } from '@gst/contracts';
import type { CorrectionInput } from '@gst/contracts';
import type {
  CalculationResult,
  CalculatedLine,
  TaxComponent,
} from './types.js';
import { scaled, money, roundHalfUp } from './money.js';
import { allocatePaise } from './allocation.js';
import { fail, validate } from './errors.js';

export const CORRECTION_POLICY_VERSION = 'original-value-adjustments.v1';
type PriorCorrection = {
  documentType: 'credit_note' | 'debit_note';
  calculation: CalculationResult;
};
const amount = (v: string) => scaled(validate(calculationMoneySchema, v));
/** Trusted immutable snapshots only; adapters must authorize and serialize writes.
 * Credits consume remaining original+debit balances, including residual tax paise.
 * Debits retain original classification/rate and normal balanced component rounding.
 * Value adjustments do not represent returned physical quantities or rate changes.
 */
export function calculateValueCorrection(
  original: CalculationResult,
  raw: CorrectionInput,
  prior: readonly PriorCorrection[] = [],
): CalculationResult {
  const input = validate(correctionInputSchema, raw);
  const source = new Map(original.lines.map((l) => [l.id, l]));
  const lines: CalculatedLine[] = input.lines.map((request) => {
    const line = source.get(request.lineId);
    if (!line)
      fail('INVALID_INPUT', 'Correction line is not on the original invoice');
    const value = amount(request.supplyValue);
    let taxComponents: TaxComponent[];
    if (input.documentType === 'credit_note') {
      let remaining = amount(line.supplyValue);
      const capacities = new Map(
        line.taxComponents.map((c) => [c.kind, amount(c.amount)]),
      );
      for (const document of prior) {
        const previous = document.calculation.lines.find(
          (l) => l.id === line.id,
        );
        if (!previous) continue;
        const sign = document.documentType === 'debit_note' ? 1n : -1n;
        remaining += sign * amount(previous.supplyValue);
        for (const c of previous.taxComponents) {
          if (!capacities.has(c.kind))
            fail('INVALID_INPUT', 'Inconsistent historical tax components');
          capacities.set(
            c.kind,
            capacities.get(c.kind)! + sign * amount(c.amount),
          );
        }
      }
      if (
        value > remaining ||
        remaining <= 0n ||
        [...capacities.values()].some((v) => v < 0n)
      )
        fail(
          'DISCOUNT_EXCEEDS_VALUE',
          'Credit exceeds the remaining original and debit-note value',
        );
      const tax = [...capacities.values()].reduce((n, v) => n + v, 0n);
      const allocated = allocatePaise(
        roundHalfUp(tax * value, remaining),
        [...capacities].map(([key, weight]) => ({ key, weight })),
      );
      taxComponents = line.taxComponents.map((c) => ({
        ...c,
        amount: money(allocated.get(c.kind)!),
      }));
    } else {
      const tax = roundHalfUp(
        value * BigInt(line.gstPercent.replace('.', '')),
        10000n,
      );
      // Central component is balanced across the entire rate group below.
      taxComponents = line.taxComponents.map((c) => ({
        ...c,
        amount: money(c.kind === 'CGST' ? 0n : tax),
      }));
    }
    const tax = taxComponents.reduce((n, c) => n + amount(c.amount), 0n);
    return {
      ...structuredClone(line),
      quantity: '1.000000',
      unitCode: 'OTH',
      catalogUnitPrice: `${request.supplyValue}00`,
      appliedUnitPrice: `${request.supplyValue}00`,
      priceIncludesGst: false,
      pricedSubtotal: money(value),
      pricedLineDiscount: '0.00',
      pricedAfterLineDiscount: money(value),
      exclusiveSubtotal: money(value),
      exclusiveLineDiscount: '0.00',
      invoiceDiscount: '0.00',
      supplyValue: money(value),
      taxComponents,
      taxTotal: money(tax),
      total: money(value + tax),
    };
  });
  const groups = new Map<string, CalculatedLine[]>();
  for (const line of lines) {
    const key = `${line.category}:${line.gstPercent}`;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }
  if (input.documentType === 'debit_note' && original.taxScheme !== 'igst')
    for (const group of groups.values()) {
      const sum = group.reduce((n, l) => n + amount(l.taxTotal), 0n);
      const central = allocatePaise(
        roundHalfUp(sum, 2n),
        group.map((l) => ({ key: l.id, weight: amount(l.taxTotal) })),
      );
      for (const line of group) {
        const tax = amount(line.taxTotal);
        line.taxComponents = line.taxComponents.map((c) => ({
          ...c,
          amount: money(
            c.kind === 'CGST'
              ? central.get(line.id)!
              : tax - central.get(line.id)!,
          ),
        }));
      }
    }
  const sum = (field: 'supplyValue' | 'taxTotal' | 'total') =>
    money(lines.reduce((n, l) => n + amount(l[field]), 0n));
  const category = (key: CalculatedLine['category']) =>
    money(
      lines
        .filter((l) => l.category === key)
        .reduce((n, l) => n + amount(l.supplyValue), 0n),
    );
  const component = (key: string, selected = lines) =>
    money(
      selected.reduce(
        (n, l) =>
          n +
          l.taxComponents
            .filter((c) => c.kind === key)
            .reduce((v, c) => v + amount(c.amount), 0n),
        0n,
      ),
    );
  return {
    ...structuredClone(original),
    lines,
    overrides: [],
    totals: {
      exclusiveSubtotal: sum('supplyValue'),
      lineDiscount: '0.00',
      invoiceDiscount: '0.00',
      supplyValue: sum('supplyValue'),
      taxableValue: category('taxable'),
      nilRatedValue: category('nil'),
      exemptValue: category('exempt'),
      cgst: component('CGST'),
      sgst: component('SGST'),
      utgst: component('UTGST'),
      igst: component('IGST'),
      taxTotal: sum('taxTotal'),
      total: sum('total'),
    },
    taxSummary: [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, group]) => ({
        category: group[0]!.category,
        gstPercent: group[0]!.gstPercent,
        supplyValue: money(
          group.reduce((n, l) => n + amount(l.supplyValue), 0n),
        ),
        taxComponents: group[0]!.taxComponents.map((c) => ({
          ...c,
          amount: component(c.kind, group),
        })),
        taxTotal: money(group.reduce((n, l) => n + amount(l.taxTotal), 0n)),
        total: money(group.reduce((n, l) => n + amount(l.total), 0n)),
      })),
  };
}
