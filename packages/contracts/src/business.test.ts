import { expect, test } from 'vitest';
import {
  businessProfileInputSchema,
  catalogInputSchema,
  customerInputSchema,
  directoryQuerySchema,
  priceSchema,
  taxPercentSchema,
} from './business.js';
const address = {
  line1: '12 Market Road',
  city: 'Mumbai',
  stateCode: '27',
  postalCode: '400001',
};
const tax = {
  hsnSac: '100630',
  category: 'taxable',
  gstPercent: '5',
  effectiveFrom: '2026-10-28',
};
const item = {
  version: 0,
  code: 'rice-1',
  name: 'Rice',
  kind: 'goods',
  unitCode: 'KGS',
  price: '0.1',
  priceIncludesGst: false,
  tax,
};
test('decimal contracts preserve exact precision and reject numeric JSON, exponents and excess scale', () => {
  expect(priceSchema.parse('99999999999999.9999')).toBe('99999999999999.9999');
  expect(priceSchema.parse('0.1')).toBe('0.1000');
  for (const value of [
    0.1,
    '1e3',
    '-0.01',
    'NaN',
    'Infinity',
    '100000000000000',
    '0.00001',
    '01.00',
  ])
    expect(priceSchema.safeParse(value).success).toBe(false);
  expect(taxPercentSchema.parse('100')).toBe('100.00');
  expect(taxPercentSchema.safeParse('100.01').success).toBe(false);
});
test('business setup restricts scheme, domestic state, PIN and matching GSTIN prefix', () => {
  const profile = {
    version: 0,
    legalName: 'Test business',
    address,
    gstin: '27AAPFU0939F1ZV',
    taxpayerType: 'regular',
    registrationConfirmed: false,
    eInvoiceApplicability: 'unknown',
  };
  expect(businessProfileInputSchema.safeParse(profile).success).toBe(true);
  expect(
    businessProfileInputSchema.safeParse({
      ...profile,
      taxpayerType: 'composition',
    }).success,
  ).toBe(false);
  expect(
    businessProfileInputSchema.safeParse({
      ...profile,
      gstin: '29AAPFU0939F1ZV',
    }).success,
  ).toBe(false);
  for (const value of [
    { ...address, stateCode: '99' },
    { ...address, postalCode: '000000' },
  ])
    expect(
      businessProfileInputSchema.safeParse({ ...profile, address: value })
        .success,
    ).toBe(false);
});
test('classification separates goods/services, date validity and nil/exempt from taxable', () => {
  expect(catalogInputSchema.parse(item).price).toBe('0.1000');
  expect(catalogInputSchema.parse(item).code).toBe('RICE-1');
  for (const value of [
    { ...item, kind: 'service' },
    { ...item, unitCode: 'UNKNOWN' },
    { ...item, tax: { ...tax, category: 'exempt' } },
    { ...item, tax: { ...tax, gstPercent: '0' } },
    { ...item, tax: { ...tax, effectiveFrom: '2026-02-30' } },
    { ...item, tax: { ...tax, category: 'zero_rated' } },
  ])
    expect(catalogInputSchema.safeParse(value).success).toBe(false);
  expect(
    catalogInputSchema.safeParse({
      ...item,
      kind: 'service',
      tax: { ...tax, hsnSac: '998313' },
    }).success,
  ).toBe(true);
});
test('customer identifiers normalize and strict inputs reject tenant and verification spoofing', () => {
  expect(
    customerInputSchema.parse({
      version: 0,
      code: 'c-1',
      name: 'Buyer',
      address,
    }).code,
  ).toBe('C-1');
  expect(
    customerInputSchema.safeParse({
      version: 0,
      code: 'c-1',
      name: 'Buyer',
      address,
      organizationId: 'other',
    }).success,
  ).toBe(false);
  expect(
    catalogInputSchema.safeParse({
      ...item,
      tax: { ...tax, verifiedBy: 'spoof' },
    }).success,
  ).toBe(false);
  expect(directoryQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  expect(directoryQuerySchema.safeParse({ offset: '1.5' }).success).toBe(false);
  expect(directoryQuerySchema.safeParse({ q: 'x'.repeat(81) }).success).toBe(
    false,
  );
});
