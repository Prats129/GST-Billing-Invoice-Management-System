import { useState } from 'react';
import { cancelInvoiceSchema, correctionInputSchema } from '@gst/contracts';
import type { InvoiceRecord } from '@gst/contracts';
import { Dialog } from '../ui.js';
import { FormError } from '../business/shared.js';
import type { Mutate, RunAction } from '../security-forms.js';
const today = () =>
  new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
interface Props {
  record: InvoiceRecord;
  basePath: string;
  busy: boolean;
  error: string;
  mutate: Mutate;
  run: RunAction;
  onClose: () => void;
  onSaved: (record: InvoiceRecord) => void;
}
export function CorrectionDialog({
  record,
  basePath,
  busy,
  error,
  mutate,
  run,
  onClose,
  onSaved,
}: Props) {
  const [key] = useState(
    () => record.correction?.requestKey ?? crypto.randomUUID(),
  );
  const [localError, setLocalError] = useState('');
  const correction = record.correction;
  const reference =
    record.snapshot?.lines ??
    record.draft.lines.map((l) => ({
      id: l.id,
      description: record.lineDescriptions[l.id] ?? 'Original item',
      supplyValue: '',
    }));
  return (
    <Dialog
      title={
        correction ? 'Edit correction draft' : 'Create credit or debit note'
      }
      onClose={onClose}
      busy={busy}
    >
      <p className="muted">
        Enter positive amounts before tax for original invoice lines. Credits
        reduce remaining value; debits increase it. Tax rates and customer
        details come from the original document.
      </p>
      <FormError message={localError || error} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const parsed = correctionInputSchema.safeParse({
            version: correction ? record.version : 0,
            requestKey: key,
            documentType: fields.get('documentType'),
            issueDate: fields.get('issueDate'),
            reason: fields.get('reason'),
            lines: reference
              .map((line) => ({
                lineId: line.id,
                supplyValue: String(fields.get(line.id) ?? ''),
              }))
              .filter((line) => line.supplyValue !== ''),
          });
          if (!parsed.success) {
            setLocalError(
              parsed.error.issues[0]?.message ??
                'Check the correction details.',
            );
            return;
          }
          setLocalError('');
          void run(async () =>
            onSaved(
              await mutate<InvoiceRecord>(
                `${basePath}/invoices/${record.id}/${correction ? 'correction' : 'corrections'}`,
                parsed.data,
                correction ? 'PUT' : 'POST',
              ),
            ),
          );
        }}
      >
        <fieldset disabled={busy} className="form-section">
          <legend>Correction details</legend>
          <label>
            Document type
            <select
              aria-label="Document type"
              name="documentType"
              defaultValue={correction?.documentType ?? 'credit_note'}
              disabled={Boolean(correction)}
            >
              <option value="credit_note">Credit note — decrease value</option>
              <option value="debit_note">Debit note — increase value</option>
            </select>
            {correction && (
              <input
                type="hidden"
                name="documentType"
                value={correction.documentType}
              />
            )}
          </label>
          <label>
            Correction issue date
            <input
              type="date"
              name="issueDate"
              required
              max={today()}
              defaultValue={correction?.issueDate ?? today()}
            />
          </label>
          <label>
            Correction reason
            <input
              name="reason"
              required
              minLength={5}
              maxLength={300}
              defaultValue={correction?.reason ?? ''}
            />
          </label>
          {reference.map((line, index) => (
            <label key={line.id}>
              {line.description}
              <small>
                {line.supplyValue
                  ? `Original value: INR ${line.supplyValue}`
                  : 'Value adjustment before tax'}
              </small>
              <input
                aria-label={`Adjustment amount ${index + 1}`}
                name={line.id}
                inputMode="decimal"
                placeholder="Leave blank to exclude"
                defaultValue={
                  correction?.lines.find((l) => l.lineId === line.id)
                    ?.supplyValue ?? ''
                }
              />
            </label>
          ))}
        </fieldset>
        <div className="card-footer">
          <button className="button button-primary" disabled={busy}>
            {correction ? 'Save correction draft' : 'Create correction draft'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function CancellationDialog({
  record,
  basePath,
  busy,
  error,
  mutate,
  run,
  onClose,
  onSaved,
}: Props) {
  const [key] = useState(() => crypto.randomUUID());
  const issued = record.number !== null;
  return (
    <Dialog
      title={issued ? 'Cancel issued document' : 'Discard draft'}
      onClose={onClose}
      busy={busy}
    >
      <p>
        The original record stays in the history. An issued number is never
        reused.
      </p>
      {issued && (
        <p className="info-note">
          Issued-document cancellation is disabled pending the compliance
          release. IRP or reported documents require their applicable external
          correction workflow.
        </p>
      )}
      <FormError message={error} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const data = cancelInvoiceSchema.parse({
            version: record.version,
            requestKey: key,
            reason: fields.get('reason'),
            noSupplyConfirmed: fields.has('noSupplyConfirmed'),
            notReportedConfirmed: fields.has('notReportedConfirmed'),
          });
          void run(async () =>
            onSaved(
              await mutate<InvoiceRecord>(
                `${basePath}/invoices/${record.id}/cancel`,
                data,
              ),
            ),
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Cancellation details</legend>
          <label>
            Cancellation reason
            <input name="reason" minLength={5} maxLength={300} required />
          </label>
          <label className="check">
            <input name="noSupplyConfirmed" type="checkbox" required />
            No supply occurred under this document.
          </label>
          <label className="check">
            <input name="notReportedConfirmed" type="checkbox" required />
            This document has not been reported or registered with an IRP.
          </label>
        </fieldset>
        <button className="button button-primary" disabled={busy || issued}>
          {issued ? 'Cancel document' : 'Discard draft'}
        </button>
      </form>
    </Dialog>
  );
}
