// Synthetic arithmetic fixtures, not a statutory rate/classification catalog.
import type { CalculationRequest, TaxRevisionView } from '@gst/contracts';
import { CALCULATION_RULE_VERSION } from '../src/policy.js';
export const reviewerId = '00000000-0000-4000-8000-000000000002';
export const actorId = '00000000-0000-4000-8000-000000000003';
export function revision(
  overrides: Partial<TaxRevisionView> = {},
): TaxRevisionView {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    hsnSac: '100630',
    category: 'taxable',
    gstPercent: '18.00',
    effectiveFrom: '2026-10-29',
    verifiedAt: '2026-10-29T00:00:00.000Z',
    verifiedBy: reviewerId,
    reference: 'Synthetic arithmetic test source',
    ...overrides,
  };
}
export function line(
  overrides: Partial<CalculationRequest['lines'][number]> = {},
): CalculationRequest['lines'][number] {
  return {
    id: 'line-a',
    kind: 'goods',
    unitCode: 'KGS',
    quantity: '1',
    catalogUnitPrice: '100',
    priceIncludesGst: false,
    taxRevisions: [revision()],
    supply: { kind: 'goods_movement', deliveryState: '27' },
    ...overrides,
  };
}
export function request(
  lines = [line()],
  overrides: Partial<CalculationRequest> = {},
): CalculationRequest {
  return {
    ruleVersion: CALCULATION_RULE_VERSION,
    supplyDate: '2026-10-29',
    context: {
      supplierState: '27',
      supplierTaxpayerType: 'regular',
      supplierRegistrationConfirmed: true,
      recipient: { kind: 'registered', locationState: '27' },
      supplyScenario: 'ordinary_domestic_forward_charge',
      valuation: 'unrelated_sole_consideration',
      independentSupplies: true,
    },
    lines,
    ...overrides,
  };
}
