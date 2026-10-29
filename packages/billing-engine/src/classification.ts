import { taxSelectionSchema } from '@gst/contracts';
import type { TaxRevisionView } from '@gst/contracts';
import { fail, validate } from './errors.js';
import { SUPPORTED_FROM } from './policy.js';
export function supportedDate(date: string) {
  if (date < SUPPORTED_FROM)
    fail(
      'UNSUPPORTED_DATE',
      'This calculation rule version does not support historical supply dates',
    );
}
/** Caller supplies the complete relevant history; never silently truncate before selection. */
export function selectTaxRevision(value: unknown): TaxRevisionView {
  const { supplyDate, revisions } = validate(taxSelectionSchema, value);
  supportedDate(supplyDate);
  if (
    new Set(revisions.map((row) => row.id)).size !== revisions.length ||
    new Set(revisions.map((row) => row.revision)).size !== revisions.length
  )
    fail(
      'INVALID_TAX_HISTORY',
      'Classification revision IDs and sequences must be unique',
    );
  const applicable = revisions
    .filter((row) => row.effectiveFrom <= supplyDate)
    .sort((a, b) =>
      a.effectiveFrom === b.effectiveFrom
        ? b.revision - a.revision
        : a.effectiveFrom > b.effectiveFrom
          ? -1
          : 1,
    );
  const selected = applicable[0];
  if (!selected)
    fail(
      'MISSING_TAX_CLASSIFICATION',
      'No classification is effective on the supply date',
    );
  if (!selected.verifiedAt || !selected.verifiedBy || !selected.reference)
    fail('TAX_NOT_REVIEWED', 'The applicable classification requires review');
  return selected;
}
export function validateHsnKind(kind: 'goods' | 'service', hsnSac: string) {
  if (
    kind === 'service' ? !/^99[0-9]{4}$/.test(hsnSac) : hsnSac.startsWith('99')
  )
    fail(
      'INVALID_CLASSIFICATION',
      'HSN/SAC classification does not match the item kind',
    );
}
