import { z } from 'zod';

// NIC domestic state master. This is address metadata, never tax jurisdiction logic.
export const indianStates = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
  ['97', 'Other Territory'],
] as const;
export const stateCodeSchema = z
  .string()
  .refine(
    (value) => indianStates.some(([code]) => code === value),
    'Choose a supported Indian state or territory',
  );
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    'Enter a 15-character PAN-based GSTIN',
  )
  .refine(
    (value) => stateCodeSchema.safeParse(value.slice(0, 2)).success,
    'Unsupported GST registration state',
  );
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).default('');
const contactEmail = z
  .union([z.literal(''), z.string().trim().toLowerCase().email().max(254)])
  .default('');
const phone = z
  .string()
  .trim()
  .max(25)
  .regex(/^[+0-9() -]*$/, 'Enter a valid contact number')
  .default('');
export const addressSchema = z
  .object({
    line1: z.string().trim().min(1).max(200),
    line2: optionalText(200),
    city: z.string().trim().min(1).max(100),
    stateCode: stateCodeSchema,
    postalCode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/, 'Enter a six-digit Indian PIN code'),
  })
  .strict();
const version = z.number().int().min(0).max(2147483646);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      value >= '1900-01-01' &&
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, 'Enter a valid calendar date from 1900 onwards');
function decimal(scale: number, whole: number, maximum?: bigint) {
  return z
    .string()
    .trim()
    .regex(
      new RegExp(`^(?:0|[1-9][0-9]{0,${whole - 1}})(?:\\.[0-9]{1,${scale}})?$`),
      `Use up to ${whole} whole digits and ${scale} decimal places`,
    )
    .transform((value) => {
      const [integer, fraction = ''] = value.split('.');
      return `${integer}.${fraction.padEnd(scale, '0')}`;
    })
    .refine(
      (value) =>
        maximum === undefined || BigInt(value.replace('.', '')) <= maximum,
      'Value exceeds the supported limit',
    );
}
export const priceSchema = decimal(4, 14);
export const taxPercentSchema = decimal(2, 3, 10000n);
export const businessProfileInputSchema = z
  .object({
    version,
    legalName: z.string().trim().min(1).max(200),
    tradeName: optionalText(200),
    address: addressSchema,
    email: contactEmail,
    phone,
    gstin: gstinSchema,
    taxpayerType: z.literal('regular'),
    registrationConfirmed: z.boolean(),
    eInvoiceApplicability: z.enum(['unknown', 'required', 'not_required']),
    bankName: optionalText(120),
    bankAccountName: optionalText(120),
    bankAccountNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{0,34}$/)
      .default(''),
    bankIfsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^(?:[A-Z]{4}0[A-Z0-9]{6})?$/)
      .default(''),
  })
  .strict()
  .refine((value) => value.gstin.slice(0, 2) === value.address.stateCode, {
    message: 'GSTIN state must match the registration address',
    path: ['gstin'],
  });
export type BusinessProfileInput = z.infer<typeof businessProfileInputSchema>;
export type Address = z.infer<typeof addressSchema>;
export const businessProfileViewSchema = businessProfileInputSchema
  .safeExtend({
    registrationId: z.string().uuid(),
    registrationConfirmedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strip();
export type BusinessProfileView = z.infer<typeof businessProfileViewSchema>;
export const businessProfileResponseSchema = z.object({
  profile: businessProfileViewSchema.nullable(),
});
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(40)
  .regex(
    /^[A-Z0-9][A-Z0-9._/-]*$/,
    'Use letters, numbers, dots, slashes, hyphens or underscores',
  );
export const customerInputSchema = z
  .object({
    version,
    code,
    name: z.string().trim().min(1).max(200),
    email: contactEmail,
    phone,
    address: addressSchema,
    gstin: z.union([z.literal(''), gstinSchema]).default(''),
    notes: optionalText(1000),
  })
  .strict();
export type CustomerInput = z.infer<typeof customerInputSchema>;
export const customerViewSchema = customerInputSchema
  .extend({
    id: z.string().uuid(),
    archivedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strip();
export type CustomerView = z.infer<typeof customerViewSchema>;
export const unitOptions = [
  { code: 'NOS', name: 'Number', precision: 0 },
  { code: 'KGS', name: 'Kilogram', precision: 3 },
  { code: 'LTR', name: 'Litre', precision: 3 },
  { code: 'MTR', name: 'Metre', precision: 3 },
  { code: 'HRS', name: 'Hour', precision: 2 },
  { code: 'DAY', name: 'Day', precision: 2 },
  { code: 'OTH', name: 'Other', precision: 6 },
] as const;
export const catalogTaxSchema = z
  .object({
    hsnSac: z
      .string()
      .regex(
        /^(?:[0-9]{4}|[0-9]{6}|[0-9]{8})$/,
        'Use a 4, 6 or 8 digit HSN, or a 6 digit SAC',
      ),
    category: z.enum(['taxable', 'nil', 'exempt']),
    gstPercent: taxPercentSchema,
    effectiveFrom: isoDate,
  })
  .strict()
  .refine(
    (value) =>
      value.category === 'taxable'
        ? value.gstPercent !== '0.00'
        : value.gstPercent === '0.00',
    'Taxable items need a positive rate; nil/exempt items must have zero GST',
  );
export const catalogInputSchema = z
  .object({
    version,
    code,
    name: z.string().trim().min(1).max(200),
    description: optionalText(1000),
    kind: z.enum(['goods', 'service']),
    unitCode: z
      .string()
      .refine(
        (value) => unitOptions.some((unit) => unit.code === value),
        'Choose a supported unit',
      ),
    price: priceSchema,
    priceIncludesGst: z.boolean(),
    tax: catalogTaxSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.kind === 'service'
        ? /^99[0-9]{4}$/.test(value.tax.hsnSac)
        : !value.tax.hsnSac.startsWith('99'),
    {
      path: ['tax', 'hsnSac'],
      message:
        'Services require a six-digit SAC starting with 99; goods require an HSN',
    },
  );
export type CatalogInput = z.infer<typeof catalogInputSchema>;
export const taxReviewSchema = z
  .object({
    version: version.refine((value) => value > 0),
    reference: z.string().trim().min(5).max(300),
  })
  .strict();
export const archiveInputSchema = z
  .object({
    version: version.refine((value) => value > 0),
    archived: z.boolean(),
  })
  .strict();
export const taxRevisionViewSchema = catalogTaxSchema
  .safeExtend({
    id: z.string().uuid(),
    revision: z.number().int(),
    verifiedAt: z.string().nullable(),
    verifiedBy: z.string().uuid().nullable(),
    reference: z.string().nullable(),
  })
  .strip();
export type TaxRevisionView = z.infer<typeof taxRevisionViewSchema>;
export const catalogViewSchema = catalogInputSchema
  .safeExtend({
    id: z.string().uuid(),
    archivedAt: z.string().nullable(),
    updatedAt: z.string(),
    tax: taxRevisionViewSchema,
  })
  .strip();
export type CatalogView = z.infer<typeof catalogViewSchema>;
export const directoryQuerySchema = z
  .object({
    q: z.string().trim().max(80).default(''),
    status: z.enum(['active', 'archived', 'all']).default('active'),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
export interface DirectoryPage<T> {
  items: T[];
  hasMore: boolean;
}
export const customerPageSchema = z.object({
  items: z.array(customerViewSchema).max(50),
  hasMore: z.boolean(),
});
export const catalogPageSchema = z.object({
  items: z.array(catalogViewSchema).max(50),
  hasMore: z.boolean(),
});
export const taxHistorySchema = z.array(taxRevisionViewSchema).max(100);
