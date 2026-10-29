import type { CalculationAuthority } from '@gst/contracts';
import type { PlaceOfSupply, TaxScheme } from './jurisdiction.js';
import type { CALCULATION_POLICY } from './policy.js';
export interface TaxComponent {
  kind: 'CGST' | 'SGST' | 'UTGST' | 'IGST';
  ratePercent: string;
  amount: string;
}
export interface AppliedOverride {
  lineId: string;
  kind: CalculationAuthority['permissions'][number];
  actorId: string;
  reason: string;
  sourceReference?: string;
  original: string;
  applied: string;
}
export interface CalculatedLine {
  id: string;
  kind: 'goods' | 'service';
  quantity: string;
  unitCode: string;
  catalogUnitPrice: string;
  appliedUnitPrice: string;
  priceIncludesGst: boolean;
  hsnSac: string;
  category: 'taxable' | 'nil' | 'exempt';
  gstPercent: string;
  taxSource: {
    revisionId: string;
    revision: number;
    verifiedAt: string;
    verifiedBy: string;
    reference: string;
  };
  placeOfSupply: PlaceOfSupply;
  pricedSubtotal: string;
  pricedLineDiscount: string;
  pricedAfterLineDiscount: string;
  exclusiveSubtotal: string;
  exclusiveLineDiscount: string;
  invoiceDiscount: string;
  supplyValue: string;
  taxComponents: TaxComponent[];
  taxTotal: string;
  total: string;
}
export interface CalculationTotals {
  exclusiveSubtotal: string;
  lineDiscount: string;
  invoiceDiscount: string;
  supplyValue: string;
  taxableValue: string;
  nilRatedValue: string;
  exemptValue: string;
  cgst: string;
  sgst: string;
  utgst: string;
  igst: string;
  taxTotal: string;
  total: string;
}
export interface TaxSummary {
  category: CalculatedLine['category'];
  gstPercent: string;
  supplyValue: string;
  taxComponents: TaxComponent[];
  taxTotal: string;
  total: string;
}
export interface CalculationResult {
  policy: typeof CALCULATION_POLICY;
  supplyDate: string;
  supplierState: string;
  placeOfSupplyState: string;
  taxScheme: TaxScheme;
  invoiceDiscountBasis: 'tax_exclusive';
  lines: CalculatedLine[];
  totals: CalculationTotals;
  taxSummary: TaxSummary[];
  overrides: AppliedOverride[];
}
