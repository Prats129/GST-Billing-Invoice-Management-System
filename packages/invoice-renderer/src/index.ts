import { logoDataSchema } from '@gst/contracts';
import type { Address, InvoicePrintData } from '@gst/contracts';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const address = (a: Address) =>
  [a.line1, a.line2, a.city, `${a.stateCode} · ${a.postalCode}`]
    .filter(Boolean)
    .map(escape)
    .join('<br>');
export function renderInvoice(data: InvoicePrintData): string {
  if (data.rendererVersion !== 'a4.v1')
    throw new Error('Unsupported renderer version');
  const draft = data.number === null;
  const heading = data.cancellation
    ? 'CANCELLED ? ' + data.title
    : draft
      ? 'DRAFT — NOT A TAX INVOICE'
      : data.title;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title><link rel="stylesheet" href="/invoice-a4-v1.css"></head><body>
  <header><div>${data.supplier.logoDataUrl && logoDataSchema.safeParse(data.supplier.logoDataUrl).success ? `<img class="business-logo" src="${escape(data.supplier.logoDataUrl)}" alt="Business logo">` : ''}<h1>${escape(data.supplier.name)}</h1><p>${address(data.supplier.address)}</p><p>GSTIN: ${escape(data.supplier.gstin)}<br>${escape(data.supplier.email)} ${escape(data.supplier.phone)}</p></div><div class="document-heading"><h2>${escape(heading)}</h2><p>${escape(data.number ?? 'No invoice number assigned')}<br>Issue date: ${escape(data.issueDate)}<br>Supply date: ${escape(data.supplyDate)}</p></div></header>
  ${draft ? '<p class="draft-warning">Calculation preview only. This document has not been issued.</p>' : ''}
  ${data.cancellation ? `<p class="cancelled-warning">Cancelled: ${escape(data.cancellation.createdAt)}<br>Reason: ${escape(data.cancellation.reason)}</p>` : ''}
  <section class="parties"><div><h3>Bill to</h3><strong>${escape(data.recipient.name)}</strong><p>${address(data.recipient.address)}</p><p>${data.recipient.gstin ? 'GSTIN: ' + escape(data.recipient.gstin) : 'Unregistered recipient'}</p></div><div><h3>Deliver to</h3><p>${address(data.deliveryAddress)}</p><p>Place of supply: ${escape(data.placeOfSupplyState)} · Reverse charge: No</p></div></section>
  ${data.originalNumber ? `<p>Original invoice: ${escape(data.originalNumber)} · ${escape(data.originalDate ?? '')}<br>Reason: ${escape(data.correctionReason)}</p>` : ''}
  <table><thead><tr><th># / Description</th><th>HSN / SAC</th><th>Qty / Unit</th><th>Unit price ₹</th><th>Line discount ₹</th><th>Supply value ₹</th><th>GST</th><th>Total ₹</th></tr></thead><tbody>${data.lines.map((l, i) => `<tr><td>${i + 1}. ${escape(l.description)}</td><td>${escape(l.hsnSac)}</td><td>${data.valueAdjustment ? 'Value adjustment' : escape(l.quantity) + ' ' + escape(l.unit)}</td><td>${data.valueAdjustment ? '?' : escape(l.unitPrice)}<small>${l.priceIncludesGst ? 'Incl. GST' : 'Excl. GST'}</small></td><td>${escape(l.discount)}</td><td>${escape(l.supplyValue)}</td><td>${escape(l.gstPercent)}%${l.taxes.map((t) => `<small>${escape(t.kind)} ${escape(t.ratePercent)}%: ₹${escape(t.amount)}</small>`).join('')}</td><td>${escape(l.total)}</td></tr>`).join('')}</tbody></table>
  <section class="totals"><p>Invoice discount (before tax)<strong>₹${escape(data.totals.invoiceDiscount)}</strong></p><p>Supply value<strong>₹${escape(data.totals.supplyValue)}</strong></p>${(
    ['cgst', 'sgst', 'utgst', 'igst'] as const
  )
    .filter((k) => data.totals[k] !== '0.00')
    .map(
      (k) =>
        `<p>${k.toUpperCase()}<strong>₹${escape(data.totals[k])}</strong></p>`,
    )
    .join(
      '',
    )}<p class="grand-total">${data.originalNumber ? (data.title === 'Debit note' ? 'Debit total' : 'Credit total') : 'Grand total'}<strong>₹${escape(data.totals.total)}</strong></p></section>
  <footer>${data.bank.accountNumber ? `<h3>Bank details</h3><p>${escape(data.bank.name)} · ${escape(data.bank.accountName)}<br>Account: ${escape(data.bank.accountNumber)} · IFSC: ${escape(data.bank.ifsc)}</p>` : ''}${data.notes ? `<h3>Notes</h3><p class="multiline">${escape(data.notes)}</p>` : ''}${data.terms ? `<h3>Terms</h3><p class="multiline">${escape(data.terms)}</p>` : ''}<p class="template-version">Template a4.v1${draft ? ' · Not valid for tax purposes' : ''}</p></footer></body></html>`;
}
