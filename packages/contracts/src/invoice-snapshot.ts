import { z } from 'zod';
import {
  addressSchema,
  calendarDateSchema,
  stateCodeSchema,
} from './business.js';
import { logoDataSchema } from './logo.js';
// Renderer transport deliberately owns only presentation data. All money is a
// decimal string and comes from the server's calculation, never from the browser.
const money = z.string().regex(/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/);
export const invoicePrintDataSchema = z.object({
  rendererVersion: z.literal('a4.v1'),
  title: z.string(),
  valueAdjustment: z.boolean().optional(),
  cancellation: z
    .object({ reason: z.string(), createdAt: z.string().datetime() })
    .optional(),
  number: z.string().max(16).nullable(),
  issueDate: calendarDateSchema,
  supplyDate: calendarDateSchema,
  supplier: z.object({
    logoDataUrl: logoDataSchema.optional(),
    name: z.string(),
    gstin: z.string(),
    address: addressSchema,
    email: z.string(),
    phone: z.string(),
  }),
  recipient: z.object({
    name: z.string(),
    gstin: z.string(),
    address: addressSchema,
  }),
  deliveryAddress: addressSchema,
  placeOfSupplyState: stateCodeSchema,
  originalNumber: z.string().nullable(),
  originalDate: calendarDateSchema.nullable(),
  correctionReason: z.string(),
  lines: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        hsnSac: z.string(),
        quantity: z.string(),
        unit: z.string(),
        unitPrice: z.string(),
        priceIncludesGst: z.boolean(),
        discount: money,
        supplyValue: money,
        gstPercent: z.string(),
        taxes: z.array(
          z.object({
            kind: z.string(),
            ratePercent: z.string(),
            amount: money,
          }),
        ),
        total: money,
      }),
    )
    .max(100),
  totals: z.object({
    supplyValue: money,
    taxTotal: money,
    total: money,
    cgst: money,
    sgst: money,
    utgst: money,
    igst: money,
    invoiceDiscount: money,
  }),
  bank: z.object({
    name: z.string(),
    accountName: z.string(),
    accountNumber: z.string(),
    ifsc: z.string(),
  }),
  notes: z.string(),
  terms: z.string(),
});
export type InvoicePrintData = z.infer<typeof invoicePrintDataSchema>;
