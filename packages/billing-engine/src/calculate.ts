import {
  calculationAuthoritySchema,
  calculationInputSchema,
} from '@gst/contracts';
import type {
  CalculationAuthority,
  CalculationDiscount,
  CalculationLine,
} from '@gst/contracts';
import { allocatePaise } from './allocation.js';
import {
  selectTaxRevision,
  supportedDate,
  validateHsnKind,
} from './classification.js';
import { fail, validate } from './errors.js';
import { determinePlaceOfSupply, taxScheme } from './jurisdiction.js';
import type { PlaceOfSupply, TaxScheme } from './jurisdiction.js';
import { formatScaled, money, roundHalfUp, scaled } from './money.js';
import { CALCULATION_POLICY, CALCULATION_RULE_VERSION } from './policy.js';
import type {
  AppliedOverride,
  CalculatedLine,
  CalculationResult,
  TaxComponent,
  TaxSummary,
} from './types.js';

const CENT_SCALE = 100000000n; // price(4) × quantity(6) -> paise(2)
const RATE_SCALE = 10000n; // rate has 2 decimals; 100 percent = 10000
interface WorkingLine {
  input: CalculationLine;
  price: string;
  rate: bigint;
  category: CalculatedLine['category'];
  hsnSac: string;
  source: CalculatedLine['taxSource'];
  place: PlaceOfSupply;
  pricedSubtotal: bigint;
  pricedAfter: bigint;
  subtotal: bigint;
  beforeInvoice: bigint;
  invoiceDiscount: bigint;
  value: bigint;
  tax: bigint;
  central: bigint;
}
function reverseBase(gross: bigint, rate: bigint): bigint {
  return gross - roundHalfUp(gross * rate, RATE_SCALE + rate);
}
function discountedPrice(
  subtotal: bigint,
  discount: CalculationDiscount,
): bigint {
  if (discount.kind === 'none') return roundHalfUp(subtotal, CENT_SCALE);
  if (discount.kind === 'percent')
    return roundHalfUp(
      subtotal * (RATE_SCALE - scaled(discount.value)),
      CENT_SCALE * RATE_SCALE,
    );
  const reduction = scaled(discount.value) * CENT_SCALE;
  if (reduction > subtotal)
    fail(
      'DISCOUNT_EXCEEDS_VALUE',
      'Line discount exceeds the entered-price value',
    );
  return roundHalfUp(subtotal - reduction, CENT_SCALE);
}
function requireAuthority(
  authority: CalculationAuthority | undefined,
  permission: CalculationAuthority['permissions'][number],
) {
  if (!authority?.permissions.includes(permission))
    fail(
      'PERMISSION_DENIED',
      'The requested override requires explicit trusted authority',
    );
  return authority.actorId;
}
function components(
  scheme: TaxScheme,
  rate: bigint,
  tax: bigint,
  central: bigint,
): TaxComponent[] {
  if (!rate) return [];
  return scheme === 'igst'
    ? [
        {
          kind: 'IGST',
          ratePercent: formatScaled(rate * 10n, 3),
          amount: money(tax),
        },
      ]
    : [
        {
          kind: 'CGST',
          ratePercent: formatScaled(rate * 5n, 3),
          amount: money(central),
        },
        {
          kind: scheme === 'cgst-utgst' ? 'UTGST' : 'SGST',
          ratePercent: formatScaled(rate * 5n, 3),
          amount: money(tax - central),
        },
      ];
}
export function calculateInvoice(
  value: unknown,
  trustedAuthority?: unknown,
): CalculationResult {
  const input = validate(calculationInputSchema, value);
  if (input.ruleVersion !== CALCULATION_RULE_VERSION)
    fail('UNSUPPORTED_RULE_VERSION', 'Unsupported calculation rule version');
  supportedDate(input.supplyDate);
  const authority =
    trustedAuthority === undefined
      ? undefined
      : validate(
          calculationAuthoritySchema,
          trustedAuthority,
          'INVALID_AUTHORITY',
        );
  const overrides: AppliedOverride[] = [];
  const rows: WorkingLine[] = input.lines.map((line) => {
    const source = selectTaxRevision({
      supplyDate: input.supplyDate,
      revisions: line.taxRevisions,
    });
    let classification = {
      hsnSac: source.hsnSac,
      category: source.category,
      gstPercent: source.gstPercent,
      effectiveFrom: source.effectiveFrom,
    };
    let price = line.catalogUnitPrice;
    if (line.priceOverride) {
      const actorId = requireAuthority(authority, 'price.override');
      price = line.priceOverride.unitPrice;
      overrides.push({
        lineId: line.id,
        kind: 'price.override',
        actorId,
        reason: line.priceOverride.reason,
        original: line.catalogUnitPrice,
        applied: price,
      });
    }
    if (line.taxOverride) {
      const actorId = requireAuthority(authority, 'tax.override');
      if (line.taxOverride.effectiveFrom > input.supplyDate)
        fail(
          'FUTURE_TAX_OVERRIDE',
          'Override classification is not effective on the supply date',
        );
      overrides.push({
        lineId: line.id,
        kind: 'tax.override',
        actorId,
        reason: line.taxOverride.reason,
        sourceReference: line.taxOverride.sourceReference,
        original: JSON.stringify(classification),
        applied: JSON.stringify({
          hsnSac: line.taxOverride.hsnSac,
          category: line.taxOverride.category,
          gstPercent: line.taxOverride.gstPercent,
          effectiveFrom: line.taxOverride.effectiveFrom,
        }),
      });
      classification = line.taxOverride;
    }
    validateHsnKind(line.kind, classification.hsnSac);
    const place = determinePlaceOfSupply(input.context, line.supply);
    if (line.placeOfSupplyOverride) {
      const actorId = requireAuthority(authority, 'place_of_supply.override');
      overrides.push({
        lineId: line.id,
        kind: 'place_of_supply.override',
        actorId,
        reason: line.placeOfSupplyOverride.reason,
        original: place.stateCode,
        applied: line.placeOfSupplyOverride.stateCode,
      });
      place.stateCode = line.placeOfSupplyOverride.stateCode;
      place.overridden = true;
    }
    const rate = scaled(classification.gstPercent);
    const exactSubtotal = scaled(line.quantity) * scaled(price);
    const pricedSubtotal = roundHalfUp(exactSubtotal, CENT_SCALE);
    const pricedAfter = discountedPrice(exactSubtotal, line.discount);
    const subtotal = line.priceIncludesGst
      ? reverseBase(pricedSubtotal, rate)
      : pricedSubtotal;
    const beforeInvoice = line.priceIncludesGst
      ? reverseBase(pricedAfter, rate)
      : pricedAfter;
    money(pricedSubtotal);
    money(subtotal);
    return {
      input: line,
      price,
      rate,
      category: classification.category,
      hsnSac: classification.hsnSac,
      source: {
        revisionId: source.id,
        revision: source.revision,
        verifiedAt: source.verifiedAt!,
        verifiedBy: source.verifiedBy!,
        reference: source.reference!,
      },
      place,
      pricedSubtotal,
      pricedAfter,
      subtotal,
      beforeInvoice,
      invoiceDiscount: 0n,
      value: 0n,
      tax: 0n,
      central: 0n,
    };
  });
  const places = new Set(rows.map((row) => row.place.stateCode));
  if (places.size !== 1)
    fail(
      'MULTIPLE_PLACES_OF_SUPPLY',
      'Split supplies with different places of supply into separate calculations',
    );
  const placeState = rows[0]!.place.stateCode;
  const scheme = taxScheme(input.context.supplierState, placeState);
  const weights = rows.map((row) => ({
    key: row.input.id,
    weight: row.input.invoiceDiscountEligible ? row.beforeInvoice : 0n,
  }));
  const eligible = weights.reduce((sum, row) => sum + row.weight, 0n);
  let invoiceDiscount = 0n;
  if (input.invoiceDiscount.kind !== 'none') {
    const requested = scaled(input.invoiceDiscount.value);
    if (requested > 0n && !eligible)
      fail(
        'NO_DISCOUNT_ELIGIBILITY',
        'A positive invoice discount requires eligible supply value',
      );
    invoiceDiscount =
      input.invoiceDiscount.kind === 'amount'
        ? requested
        : roundHalfUp(eligible * requested, RATE_SCALE);
  }
  const allocation = allocatePaise(invoiceDiscount, weights);
  const groups = new Map<string, WorkingLine[]>();
  for (const row of rows) {
    row.invoiceDiscount = allocation.get(row.input.id)!;
    row.value = row.beforeInvoice - row.invoiceDiscount;
    row.tax =
      row.input.priceIncludesGst && !row.invoiceDiscount
        ? row.pricedAfter - row.beforeInvoice
        : roundHalfUp(row.value * row.rate, RATE_SCALE);
    const key = `${row.category}:${formatScaled(row.rate, 2)}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
    money(row.value + row.tax);
  }
  if (scheme !== 'igst')
    for (const group of groups.values()) {
      const totalTax = group.reduce((sum, row) => sum + row.tax, 0n);
      const central = allocatePaise(
        roundHalfUp(totalTax, 2n),
        group.map((row) => ({ key: row.input.id, weight: row.tax })),
      );
      for (const row of group) row.central = central.get(row.input.id)!;
    }
  const lines: CalculatedLine[] = rows.map((row) => ({
    id: row.input.id,
    kind: row.input.kind,
    quantity: row.input.quantity,
    unitCode: row.input.unitCode,
    catalogUnitPrice: row.input.catalogUnitPrice,
    appliedUnitPrice: row.price,
    priceIncludesGst: row.input.priceIncludesGst,
    hsnSac: row.hsnSac,
    category: row.category,
    gstPercent: formatScaled(row.rate, 2),
    taxSource: row.source,
    placeOfSupply: row.place,
    pricedSubtotal: money(row.pricedSubtotal),
    pricedLineDiscount: money(row.pricedSubtotal - row.pricedAfter),
    pricedAfterLineDiscount: money(row.pricedAfter),
    exclusiveSubtotal: money(row.subtotal),
    exclusiveLineDiscount: money(row.subtotal - row.beforeInvoice),
    invoiceDiscount: money(row.invoiceDiscount),
    supplyValue: money(row.value),
    taxComponents: components(scheme, row.rate, row.tax, row.central),
    taxTotal: money(row.tax),
    total: money(row.value + row.tax),
  }));
  const sum = (
    field: 'subtotal' | 'invoiceDiscount' | 'value' | 'tax' | 'central',
  ) => rows.reduce((total, row) => total + row[field], 0n);
  const totalValue = sum('value');
  const totalTax = sum('tax');
  const central = sum('central');
  const categoryValue = (category: WorkingLine['category']) =>
    money(
      rows
        .filter((row) => row.category === category)
        .reduce((total, row) => total + row.value, 0n),
    );
  const taxSummary: TaxSummary[] = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => {
      const first = group[0]!;
      const value = group.reduce((sum, row) => sum + row.value, 0n);
      const tax = group.reduce((sum, row) => sum + row.tax, 0n);
      const central = group.reduce((sum, row) => sum + row.central, 0n);
      return {
        category: first.category,
        gstPercent: formatScaled(first.rate, 2),
        supplyValue: money(value),
        taxComponents: components(scheme, first.rate, tax, central),
        taxTotal: money(tax),
        total: money(value + tax),
      };
    });
  return {
    policy: { ...CALCULATION_POLICY },
    supplyDate: input.supplyDate,
    supplierState: input.context.supplierState,
    placeOfSupplyState: placeState,
    taxScheme: scheme,
    invoiceDiscountBasis: 'tax_exclusive',
    lines,
    totals: {
      exclusiveSubtotal: money(sum('subtotal')),
      lineDiscount: money(
        rows.reduce((sum, row) => sum + row.subtotal - row.beforeInvoice, 0n),
      ),
      invoiceDiscount: money(sum('invoiceDiscount')),
      supplyValue: money(totalValue),
      taxableValue: categoryValue('taxable'),
      nilRatedValue: categoryValue('nil'),
      exemptValue: categoryValue('exempt'),
      cgst: money(central),
      sgst: money(scheme === 'cgst-sgst' ? totalTax - central : 0n),
      utgst: money(scheme === 'cgst-utgst' ? totalTax - central : 0n),
      igst: money(scheme === 'igst' ? totalTax : 0n),
      taxTotal: money(totalTax),
      total: money(totalValue + totalTax),
    },
    taxSummary,
    overrides,
  };
}
