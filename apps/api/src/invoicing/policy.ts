import { createHash } from 'node:crypto';
import { CALCULATION_POLICY } from '@gst/billing-engine';
import { deny } from '../security/errors.js';

// Stable object-key order makes checksums independent of PostgreSQL JSONB order.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const checksum = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function financialYear(date: string) {
  const year =
    Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0);
  return `${String(year).slice(-2)}${String(year + 1).slice(-2)}`;
}
export function indianToday() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
function released(documentType: string, action: 'issue' | 'cancel') {
  // Only ordinary invoices are included in this release. Neither configuration
  // nor an HTTP/admin input can expand this to correction or cancellation policy.
  return (
    CALCULATION_POLICY.issuanceAllowed &&
    documentType === 'invoice' &&
    action === 'issue'
  );
}
export function issuanceBlockers(
  documentType: string,
  applicability: 'unknown' | 'required' | 'not_required',
) {
  return [
    ...(!released(documentType, 'issue')
      ? [
          documentType === 'invoice'
            ? 'Invoice issuance has not been released.'
            : 'Credit and debit note issuance is not included in the current release.',
        ]
      : []),
    ...(applicability === 'unknown'
      ? [
          'Confirm whether this business requires e-invoicing in Business setup before finalizing.',
        ]
      : applicability === 'required'
        ? [
            'This business requires e-invoicing. Issuance is blocked while IRP integration is on hold.',
          ]
        : []),
  ];
}
export function assertCalculationReleased(
  documentType: string = 'invoice',
  action: 'issue' | 'cancel' = 'issue',
) {
  if (!released(documentType, action)) deny('ISSUANCE_BLOCKED');
}
