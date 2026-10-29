import { z } from 'zod';
import {
  calendarDateSchema,
  catalogTaxSchema,
  decimalStringSchema,
  priceSchema,
  stateCodeSchema,
  taxRevisionViewSchema,
  unitOptions,
} from './business.js';

export const MAX_CALCULATION_LINES = 1000;
export const MAX_TAX_REVISIONS_PER_LINE = 100;
export const calculationMoneySchema = decimalStringSchema(2, 16);
export const quantitySchema = decimalStringSchema(6, 9).refine(
  (value) => /^\d+\.\d{6}$/.test(value) && BigInt(value.replace('.', '')) > 0n,
  'Quantity must be positive',
);
export const discountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({ kind: z.literal('amount'), value: calculationMoneySchema })
    .strict(),
  z
    .object({
      kind: z.literal('percent'),
      value: decimalStringSchema(2, 3, 10000n),
    })
    .strict(),
]);
export type CalculationDiscount = z.infer<typeof discountSchema>;
export const supplyFactsSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('goods_movement'),
      deliveryState: stateCodeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('goods_no_movement'),
      goodsLocationState: stateCodeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('goods_unregistered'),
      invoiceAddressState: stateCodeSchema.nullable(),
      deliveryAddressState: stateCodeSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('general_service'),
      specialRuleApplies: z.literal(false),
      suppliedThroughEcommerce: z.literal(false),
    })
    .strict(),
]);
export type SupplyFacts = z.infer<typeof supplyFactsSchema>;
export const calculationContextSchema = z
  .object({
    supplierState: stateCodeSchema,
    supplierTaxpayerType: z.literal('regular'),
    supplierRegistrationConfirmed: z.literal(true),
    recipient: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('registered'),
          locationState: stateCodeSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('unregistered'),
          addressOnRecordState: stateCodeSchema.nullable(),
        })
        .strict(),
    ]),
    supplyScenario: z.literal('ordinary_domestic_forward_charge'),
    valuation: z.literal('unrelated_sole_consideration'),
    independentSupplies: z.literal(true),
  })
  .strict();
export type CalculationContext = z.infer<typeof calculationContextSchema>;
const reason = z.string().trim().min(5).max(300);
export const calculationTaxRevisionSchema = taxRevisionViewSchema
  .safeExtend({
    revision: z.number().int().min(1),
    verifiedAt: z.string().datetime().nullable(),
    reference: reason.nullable(),
  })
  .strict();
export const taxSelectionSchema = z
  .object({
    supplyDate: calendarDateSchema,
    revisions: z
      .array(calculationTaxRevisionSchema)
      .min(1)
      .max(MAX_TAX_REVISIONS_PER_LINE),
  })
  .strict();
export const calculationLineSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    kind: z.enum(['goods', 'service']),
    unitCode: z
      .string()
      .refine(
        (value) => unitOptions.some((unit) => unit.code === value),
        'Unsupported unit',
      ),
    quantity: quantitySchema,
    catalogUnitPrice: priceSchema,
    priceIncludesGst: z.boolean(),
    taxRevisions: z
      .array(calculationTaxRevisionSchema)
      .min(1)
      .max(MAX_TAX_REVISIONS_PER_LINE),
    supply: supplyFactsSchema,
    discount: discountSchema.default({ kind: 'none' }),
    invoiceDiscountEligible: z.boolean().default(true),
    priceOverride: z
      .object({ unitPrice: priceSchema, reason })
      .strict()
      .optional(),
    taxOverride: catalogTaxSchema
      .safeExtend({ reason, sourceReference: reason })
      .strict()
      .optional(),
    placeOfSupplyOverride: z
      .object({ stateCode: stateCodeSchema, reason })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((line, ctx) => {
    const unit = unitOptions.find((value) => value.code === line.unitCode);
    if (
      unit &&
      /[1-9]/.test((line.quantity.split('.')[1] ?? '').slice(unit.precision))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Quantity exceeds unit precision',
      });
    if ((line.kind === 'service') !== (line.supply.kind === 'general_service'))
      ctx.addIssue({
        code: 'custom',
        path: ['supply'],
        message: 'Supply facts do not match the item kind',
      });
  });
export const calculationInputSchema = z
  .object({
    ruleVersion: z.string().min(1).max(80),
    supplyDate: calendarDateSchema,
    context: calculationContextSchema,
    lines: z.array(calculationLineSchema).min(1).max(MAX_CALCULATION_LINES),
    invoiceDiscount: discountSchema.default({ kind: 'none' }),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.lines.forEach((line, index) => {
      if (seen.has(line.id))
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'id'],
          message: 'Line IDs must be unique',
        });
      seen.add(line.id);
    });
  });
export type CalculationInput = z.infer<typeof calculationInputSchema>;
export type CalculationLine = z.infer<typeof calculationLineSchema>;
export type CalculationRequest = z.input<typeof calculationInputSchema>;
export const calculationAuthoritySchema = z
  .object({
    actorId: z.string().uuid(),
    permissions: z
      .array(
        z.enum(['price.override', 'tax.override', 'place_of_supply.override']),
      )
      .max(3),
  })
  .strict()
  .refine(
    (value) => new Set(value.permissions).size === value.permissions.length,
    'Duplicate authority permissions',
  );
export type CalculationAuthority = z.infer<typeof calculationAuthoritySchema>;
