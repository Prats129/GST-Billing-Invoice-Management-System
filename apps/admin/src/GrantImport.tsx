import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { signedEntitlementSchema } from '@gst/contracts';
import { readJsonFile } from '@gst/ui/json-files';
import { Notification } from '@gst/ui/notifications';
import { Form, Field } from './components.js';
import { requestKey } from './api.js';
import { value } from './forms.js';
import type { Detail } from './types.js';

export function parseGrantImport(data: unknown) {
  const result = z
    .array(signedEntitlementSchema)
    .min(1)
    .max(100)
    .safeParse(Array.isArray(data) ? data : [data]);
  if (!result.success)
    throw new Error(
      'Choose a signed grant envelope or an ordered array of up to 100 envelopes. Signature verification happens on the server.',
    );
  return result.data;
}
const title = 'Import signed grant or reconcile history';
export function GrantImport({
  detail,
  busy,
  mark,
  save,
}: {
  detail: Detail;
  busy: boolean;
  mark: (dirty: boolean, source?: string) => void;
  save: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<{
    name: string;
    grants: ReturnType<typeof parseGrantImport>;
  } | null>(null);
  const [reading, setReading] = useState(false),
    [error, setError] = useState('');
  const active = useRef(true),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <Form
      title={title}
      submit="Verify and import"
      busy={busy || reading}
      dirty={mark}
      onSave={async (data) => {
        const manual = value(data, 'grants');
        if (selected && manual)
          throw new Error(
            'Choose the uploaded file or pasted JSON. Clear one before importing.',
          );
        let grants: ReturnType<typeof parseGrantImport>;
        if (selected) grants = selected.grants;
        else {
          if (!manual)
            throw new Error(
              'Choose a signed grant file first, or paste the signed envelope JSON.',
            );
          let parsed: unknown;
          try {
            parsed = JSON.parse(manual) as unknown;
          } catch {
            throw new Error('The pasted envelope is not valid JSON.');
          }
          grants = parseGrantImport(parsed);
        }
        await save('organizations/' + detail.organization.id + '/grants', {
          requestId: value(data, 'requestId') || null,
          grants,
          requestKey: requestKey(),
        });
        setSelected(null);
        setError('');
      }}
    >
      <p>
        Choose the externally signed file. This verifies and records grants;
        applying online access or delivering an offline file remains a separate
        explicit action.
      </p>
      <Field label="Request to match" name="requestId" required={false}>
        <option value="">
          History reconciliation (complete verified chain)
        </option>
        {detail.requests.map((request) => (
          <option key={request.id} value={request.id}>
            {request.id}
          </option>
        ))}
      </Field>
      <label>
        Signed grant file (JSON)
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            mark(true, title);
            setSelected(null);
            setReading(true);
            setError('');
            void readJsonFile(file, 900000)
              .then((data) => {
                const grants = parseGrantImport(data);
                if (active.current) setSelected({ name: file.name, grants });
              })
              .catch((reason: unknown) => {
                if (active.current)
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : 'The signed file could not be read.',
                  );
              })
              .finally(() => {
                if (active.current) setReading(false);
              });
          }}
        />
      </label>
      <p className="muted">
        Maximum 900,000 bytes. Public signed envelopes only; never upload a
        private key or publisher register.
      </p>
      {selected && (
        <p role="status">
          Selected {selected.name}: {selected.grants.length} envelope(s).
          Unverified until the server accepts the import.{' '}
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              if (input.current) input.current.value = '';
              mark(true, title);
            }}
          >
            Clear selected file
          </button>
        </p>
      )}
      {error && <Notification message={error} onDismiss={() => setError('')} />}
      <Field
        label="Signed envelope JSON (or ordered array)"
        name="grants"
        type="textarea"
        required={false}
      />
    </Form>
  );
}
