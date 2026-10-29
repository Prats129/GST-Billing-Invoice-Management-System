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
export function assertCalculationReleased() {
  // Deliberately no environment/HTTP/admin override. A reviewed release must
  // replace the pending policy before real documents can be issued.
  if (!CALCULATION_POLICY.issuanceAllowed) deny('ISSUANCE_BLOCKED');
}
