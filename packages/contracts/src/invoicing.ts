import { z } from 'zod';
import { addressSchema, calendarDateSchema } from './business.js';
import { calculationLineSchema, discountSchema } from './billing.js';
import { calculationMoneySchema } from './billing.js';
import { invoicePrintDataSchema } from './invoice-snapshot.js';
import type { InvoicePrintData } from './invoice-snapshot.js';

export const invoiceDraftLineSchema = z
  .object({
    id: calculationLineSchema.shape.id,
    quantity: calculationLineSchema.shape.quantity,
    discount: calculationLineSchema.shape.discount,
    invoiceDiscountEligible:
      calculationLineSchema.shape.invoiceDiscountEligible,
    priceOverride: calculationLineSchema.shape.priceOverride,
    taxOverride: calculationLineSchema.shape.taxOverride,
    placeOfSupplyOverride: calculationLineSchema.shape.placeOfSupplyOverride,
    catalogItemId: z.string().uuid(),
  })
  .strict();
export const invoiceDraftSchema = z
  .object({
    version: z.number().int().min(0).max(2147483646),
    customerId: z.string().uuid(),
    issueDate: calendarDateSchema,
    supplyDate: calendarDateSchema,
    deliveryAddress: addressSchema,
    goodsTreatment: z.enum(['movement', 'no_movement']).default('movement'),
    ordinarySupplyConfirmed: z.literal(true),
    lines: z.array(invoiceDraftLineSchema).min(1).max(100),
    invoiceDiscount: discountSchema.default({ kind: 'none' }),
    notes: z.string().trim().max(1000).default(''),
    terms: z.string().trim().max(2000).default(''),
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.id)).size === v.lines.length,
    'Duplicate line identifiers',
  );
export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;
export type InvoiceDraftLine = z.infer<typeof invoiceDraftLineSchema>;
export const createInvoiceSchema = invoiceDraftSchema.safeExtend({
  requestKey: z.string().uuid(),
});
export const finalizeInvoiceSchema = z
  .object({
    version: z.number().int().positive().max(2147483646),
    requestKey: z.string().uuid(),
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type FinalizeInvoice = z.infer<typeof finalizeInvoiceSchema>;
export const correctionInputSchema = z
  .object({
    version: z.number().int().min(0).max(2147483646),
    requestKey: z.string().uuid(),
    documentType: z.enum(['credit_note', 'debit_note']),
    issueDate: calendarDateSchema,
    reason: z.string().trim().min(5).max(300),
    lines: z
      .array(
        z
          .object({
            lineId: calculationLineSchema.shape.id,
            supplyValue: calculationMoneySchema.refine(
              (v) => BigInt(v.replace('.', '')) > 0n,
              'Enter a positive adjustment',
            ),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.lineId)).size === v.lines.length,
    'Duplicate correction lines',
  );
export type CorrectionInput = z.infer<typeof correctionInputSchema>;
export const cancelInvoiceSchema = z
  .object({
    version: z.number().int().positive(),
    requestKey: z.string().uuid(),
    reason: z.string().trim().min(5).max(300),
    noSupplyConfirmed: z.literal(true),
    notReportedConfirmed: z.literal(true),
  })
  .strict();
export type CancelInvoice = z.infer<typeof cancelInvoiceSchema>;
export const reverseInvoiceSchema = z
  .object({
    requestKey: z.string().uuid(),
    issueDate: calendarDateSchema,
    reason: z.string().trim().min(5).max(300),
  })
  .strict();
export const invoiceListQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export interface InvoiceSummary {
  id: string;
  version: number;
  status: 'draft' | 'finalized' | 'cancelled';
  documentType: 'invoice' | 'credit_note' | 'debit_note';
  number: string | null;
  customerName: string;
  issueDate: string;
  updatedAt: string;
}
export interface InvoiceRecord extends InvoiceSummary {
  draft: InvoiceDraft;
  originalId: string | null;
  correctionReason: string;
  snapshot: InvoicePrintData | null;
  snapshotDigest: string | null;
  lineDescriptions: Record<string, string>;
  correction: CorrectionInput | null;
  cancellation: { reason: string; createdAt: string } | null;
}
export interface InvoicePreview {
  digest: string;
  print: InvoicePrintData;
  issuanceBlockers: string[];
}
export * from './invoice-snapshot.js';

export const invoiceSummarySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'finalized', 'cancelled']),
  documentType: z.enum(['invoice', 'credit_note', 'debit_note']),
  number: z.string().max(16).nullable(),
  customerName: z.string(),
  issueDate: calendarDateSchema,
  updatedAt: z.string().datetime(),
});
export const invoiceRecordSchema = invoiceSummarySchema.extend({
  correction: correctionInputSchema.nullable(),
  cancellation: z
    .object({ reason: z.string(), createdAt: z.string().datetime() })
    .nullable(),
  lineDescriptions: z.record(z.string(), z.string()),
  draft: invoiceDraftSchema,
  originalId: z.string().uuid().nullable(),
  correctionReason: z.string(),
  snapshot: invoicePrintDataSchema.nullable(),
  snapshotDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const invoicePageSchema = z.object({
  items: z.array(invoiceSummarySchema).max(50),
  hasMore: z.boolean(),
});
export const invoicePreviewSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  print: invoicePrintDataSchema,
  issuanceBlockers: z.array(z.string()).max(10),
});
