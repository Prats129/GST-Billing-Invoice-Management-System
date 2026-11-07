import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { submission, PlatformApiError } from './api.js';
import type { Operation } from './types.js';
import { platformProblem } from './problems.js';
import { Notification } from '@gst/ui/notifications';
export function Field({
  label,
  name,
  type = 'text',
  required = true,
  defaultValue = '',
  children,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  children?: ReactNode;
}) {
  return (
    <label>
      {label}
      {children ? (
        <select
          aria-label={label}
          name={name}
          defaultValue={defaultValue}
          required={required}
        >
          {children}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          name={name}
          required={required}
          maxLength={100000}
          rows={4}
          defaultValue={defaultValue}
        />
      ) : (
        <input
          name={name}
          type={type}
          required={required}
          defaultValue={defaultValue}
          maxLength={type === 'password' ? 128 : 1000}
          step={type === 'number' ? '0.01' : undefined}
        />
      )}
    </label>
  );
}
export function Form({
  title,
  children,
  onSave,
  busy,
  dirty,
  submit = 'Save',
}: {
  title: string;
  children: ReactNode;
  onSave: (d: FormData) => Promise<unknown>;
  busy: boolean;
  dirty: (v: boolean, source?: string) => void;
  submit?: string;
}) {
  const [formError, setFormError] = useState('');
  const key = useRef(crypto.randomUUID());
  return (
    <section className="card">
      <h2>{title}</h2>
      {formError && (
        <Notification message={formError} onDismiss={() => setFormError('')} />
      )}
      <form
        onChange={() => {
          dirty(true, title);
          key.current = crypto.randomUUID();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setFormError('');
          submission(key.current);
          void Promise.resolve()
            .then(() => onSave(new FormData(form)))
            .then(() => {
              form.reset();
              dirty(false, title);
              key.current = crypto.randomUUID();
            })
            .catch((e) => {
              setFormError(
                e instanceof PlatformApiError
                  ? ''
                  : e instanceof Error
                    ? e.message
                    : 'Check the form fields.',
              );
            })
            .finally(() => submission());
        }}
      >
        <fieldset disabled={busy}>
          {children}
          <button className="primary">{submit}</button>
        </fieldset>
      </form>
    </section>
  );
}
export function Table({ rows: records }: { rows: Record<string, unknown>[] }) {
  if (!records.length) return <p className="muted">No records yet.</p>;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {Object.keys(records[0]!).map((k) => (
              <th key={k}>{k.replaceAll('_', ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              {Object.values(r).map((v, j) => (
                <td key={j}>
                  {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OperationList({
  operations,
  busy,
  retry,
}: {
  operations: Operation[];
  busy: boolean;
  retry: (id: string) => Promise<unknown>;
}) {
  return (
    <>
      <Table
        rows={operations.map((o) => ({
          id: o.id,
          action: o.kind,
          state: o.state,
          detail: o.error_code
            ? platformProblem(o.error_code, o.error_code)
            : o.state === 'pending'
              ? 'Waiting for the worker. Refresh status; if this remains pending, ask the host operator to check that operations are enabled and the billing connection is configured.'
              : o.state === 'running'
                ? 'Processing. Wait and refresh status; do not submit a duplicate request.'
                : o.state === 'completed'
                  ? 'The billing database confirmed this operation.'
                  : '',
          result: o.result,
        }))}
      />
      {operations
        .filter((o) => o.state === 'retryable')
        .map((o) => (
          <button
            key={o.id}
            disabled={busy}
            onClick={() => void retry(o.id).catch(() => {})}
          >
            Retry {o.kind} · {o.id.slice(0, 8)}
          </button>
        ))}
    </>
  );
}
