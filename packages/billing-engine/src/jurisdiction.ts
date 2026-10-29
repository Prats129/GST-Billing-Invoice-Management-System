import type { CalculationContext, SupplyFacts } from '@gst/contracts';
import { fail } from './errors.js';
export interface PlaceOfSupply {
  stateCode: string;
  basis:
    | 'igst-10-1-a'
    | 'igst-10-1-c'
    | 'igst-10-1-ca'
    | 'igst-12-2-a'
    | 'igst-12-2-b';
  overridden: boolean;
}
export type TaxScheme = 'cgst-sgst' | 'cgst-utgst' | 'igst';
const territoryTaxStates = new Set(['04', '26', '31', '35', '38', '97']);
export function determinePlaceOfSupply(
  context: CalculationContext,
  supply: SupplyFacts,
): PlaceOfSupply {
  if (supply.kind === 'general_service') {
    return context.recipient.kind === 'registered'
      ? {
          stateCode: context.recipient.locationState,
          basis: 'igst-12-2-a',
          overridden: false,
        }
      : {
          stateCode:
            context.recipient.addressOnRecordState ?? context.supplierState,
          basis: 'igst-12-2-b',
          overridden: false,
        };
  }
  if (supply.kind === 'goods_unregistered') {
    if (context.recipient.kind !== 'unregistered')
      fail(
        'UNSUPPORTED_SCENARIO',
        'Unregistered goods facts require an unregistered recipient',
      );
    return {
      stateCode:
        supply.deliveryAddressState ??
        supply.invoiceAddressState ??
        context.supplierState,
      basis: 'igst-10-1-ca',
      overridden: false,
    };
  }
  if (context.recipient.kind !== 'registered')
    fail(
      'UNSUPPORTED_SCENARIO',
      'Unregistered goods require the invoice/delivery address rule',
    );
  return supply.kind === 'goods_movement'
    ? {
        stateCode: supply.deliveryState,
        basis: 'igst-10-1-a',
        overridden: false,
      }
    : {
        stateCode: supply.goodsLocationState,
        basis: 'igst-10-1-c',
        overridden: false,
      };
}
export function taxScheme(
  supplierState: string,
  placeState: string,
): TaxScheme {
  return supplierState !== placeState
    ? 'igst'
    : territoryTaxStates.has(supplierState)
      ? 'cgst-utgst'
      : 'cgst-sgst';
}
