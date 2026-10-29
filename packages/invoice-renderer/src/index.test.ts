import { expect, test } from 'vitest';
import type { InvoicePrintData } from '@gst/contracts';
import { renderInvoice } from './index.js';
const address = {
  line1: '<script>alert(1)</script>',
  line2: '',
  city: 'Mumbai',
  stateCode: '27',
  postalCode: '400001',
};
const data: InvoicePrintData = {
  rendererVersion: 'a4.v1',
  title: 'Tax invoice',
  number: null,
  issueDate: '2026-10-29',
  supplyDate: '2026-10-29',
  supplier: {
    name: '<img src=x onerror=alert(1)>',
    gstin: '27AAPFU0939F1ZV',
    address,
    email: '',
    phone: '',
  },
  recipient: { name: 'Buyer & co', gstin: '', address },
  deliveryAddress: address,
  placeOfSupplyState: '27',
  originalNumber: null,
  originalDate: null,
  correctionReason: '',
  lines: [],
  totals: {
    supplyValue: '0.00',
    taxTotal: '0.00',
    total: '0.00',
    cgst: '0.00',
    sgst: '0.00',
    utgst: '0.00',
    igst: '0.00',
    invoiceDiscount: '0.00',
  },
  bank: { name: '', accountName: '', accountNumber: '', ifsc: '' },
  notes: '<iframe src="evil">',
  terms: '"quoted"',
};
test('draft is unmistakable and untrusted content cannot create markup', () => {
  const html = renderInvoice(data);
  expect(html).toContain('DRAFT — NOT A TAX INVOICE');
  expect(html).toContain('No invoice number assigned');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<iframe');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('Buyer &amp; co');
  expect(html).toContain('href="/invoice-a4-v1.css"');
});
test('historical documents print their number, linked original and version', () => {
  const html = renderInvoice({
    ...data,
    title: 'Credit note',
    number: 'CN/2627/000001',
    originalNumber: 'INV/2627/000001',
    originalDate: '2026-10-29',
    correctionReason: 'Returned goods',
  });
  expect(html).toContain('Credit note');
  expect(html).toContain('Original invoice: INV/2627/000001');
  expect(html).not.toContain('DRAFT');
  expect(() =>
    renderInvoice({ ...data, rendererVersion: 'a4.v2' as 'a4.v1' }),
  ).toThrow('Unsupported');
});
test('logos are raster-only and cancelled copies preserve their number with escaped reasons', () => {
  const logo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const html = renderInvoice({
    ...data,
    number: 'INV/2627/000001',
    supplier: { ...data.supplier, logoDataUrl: logo },
    cancellation: {
      reason: 'Entered <script> by mistake',
      createdAt: '2026-10-29T00:00:00.000Z',
    },
  });
  expect(html).toContain('class="business-logo"');
  expect(html).toContain('CANCELLED');
  expect(html).toContain('INV/2627/000001');
  expect(html).toContain('Entered &lt;script&gt;');
  expect(
    renderInvoice({
      ...data,
      supplier: {
        ...data.supplier,
        logoDataUrl: 'data:image/svg+xml,<svg onload="alert(1)"/>',
      },
    }),
  ).not.toContain('<img');
});
