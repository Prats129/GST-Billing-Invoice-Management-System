import { useEffect, useRef, useState } from 'react';
import { platformOrganization } from '@gst/contracts/platform';
import { offlineRegistrationSchema } from '@gst/contracts';
import { readJsonFile } from '@gst/ui/json-files';
import { Notification } from '@gst/ui/notifications';
import { api, requestKey } from './api.js';

export function OrganizationOnboarding({
  busy,
  mark,
  run,
  onDone,
}: {
  busy: boolean;
  mark: (dirty: boolean) => void;
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  onDone: (id: string) => void;
}) {
  const [values, setValues] = useState({
    name: '',
    email: '',
    contactName: '',
    phone: '',
    edition: 'saas',
    mode: 'create',
    runtimeId: '',
    installationId: '',
  });
  const [review, setReview] = useState(false),
    [error, setError] = useState(''),
    [reading, setReading] = useState(false);
  const key = useRef(requestKey()),
    submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const change = (next: Partial<typeof values>) => {
    setValues((v) => ({ ...v, ...next }));
    mark(true);
    key.current = requestKey();
    setReview(false);
    setError('');
  };
  const input = (
    label: string,
    name:
      | 'name'
      | 'email'
      | 'contactName'
      | 'phone'
      | 'runtimeId'
      | 'installationId',
    required = true,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={values[name]}
        required={required}
        type={name === 'email' ? 'email' : 'text'}
        maxLength={name.endsWith('Id') ? 36 : 254}
        onChange={(e) => change({ [name]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="card" aria-labelledby="onboarding-heading">
      <h2 id="onboarding-heading">
        {review ? 'Review organization' : 'Organization details'}
      </h2>
      <p>
        Step{' '}
        {review
          ? '2 of 2 · Confirm the mapping'
          : '1 of 2 · Choose the customer and edition'}
      </p>
      {error && <Notification message={error} onDismiss={() => setError('')} />}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting.current || busy || reading) return;
          const parsed = platformOrganization.safeParse({
            ...values,
            runtimeId: values.runtimeId || undefined,
            installationId: values.installationId || undefined,
            requestKey: key.current,
          });
          if (!parsed.success) {
            setError(
              'Check the organization fields: ' +
                parsed.error.issues
                  .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                  .join('; '),
            );
            return;
          }
          if (!review) {
            setReview(true);
            return;
          }
          submitting.current = true;
          void run(async () => {
            const result = await api<{ id: string }>(
              'organizations',
              parsed.data,
            );
            mark(false);
            onDone(result.id);
          })
            .catch(() => {})
            .finally(() => {
              submitting.current = false;
            });
        }}
      >
        <fieldset disabled={busy || reading}>
          {review ? (
            <>
              <dl className="review-summary">
                <dt>Organization</dt>
                <dd>{values.name}</dd>
                <dt>Owner/contact email</dt>
                <dd>{values.email}</dd>
                <dt>Edition</dt>
                <dd>
                  {values.edition === 'saas'
                    ? 'Online SaaS'
                    : 'Offline Windows'}
                </dd>
                <dt>Registration method</dt>
                <dd>
                  {values.mode === 'create'
                    ? 'Create new hosted identity'
                    : 'Link existing identity'}
                </dd>
                {values.runtimeId && (
                  <>
                    <dt>Runtime organization</dt>
                    <dd>{values.runtimeId}</dd>
                  </>
                )}
                {values.installationId && (
                  <>
                    <dt>Offline installation</dt>
                    <dd>{values.installationId}</dd>
                  </>
                )}
              </dl>
              <p>
                {values.edition === 'offline'
                  ? 'This records the supplied host identifiers. It does not verify installation, create local accounts or remotely activate access.'
                  : values.mode === 'create'
                    ? 'A durable provisioning operation will create the hosted identity. Then verify its status and generate the owner setup link. A signed license is a separate step.'
                    : 'The server will verify the existing hosted organization before linking it. Existing accounts and passwords are preserved.'}
              </p>
              <div className="actions">
                <button type="button" onClick={() => setReview(false)}>
                  Edit details
                </button>
                <button className="primary">Register organization</button>
              </div>
            </>
          ) : (
            <>
              <div className="grid">
                <label>
                  Edition
                  <select
                    aria-label="Edition"
                    value={values.edition}
                    onChange={(e) =>
                      change({
                        edition: e.target.value,
                        mode: e.target.value === 'offline' ? 'link' : 'create',
                        runtimeId: '',
                        installationId: '',
                      })
                    }
                  >
                    <option value="saas">Online SaaS</option>
                    <option value="offline">Offline Windows</option>
                  </select>
                </label>
                <label>
                  Registration method
                  <select
                    aria-label="Registration method"
                    value={values.mode}
                    onChange={(e) =>
                      change({
                        mode: e.target.value,
                        runtimeId: '',
                        installationId: '',
                      })
                    }
                  >
                    {values.edition === 'saas' && (
                      <option value="create">Create online organization</option>
                    )}
                    <option value="link">Link existing organization</option>
                  </select>
                </label>
                {input('Business name', 'name')}
                {input('Owner/contact email', 'email')}
                {input('Contact name', 'contactName', false)}
                {input('Phone', 'phone', false)}
                {values.mode === 'link' &&
                  input('Existing runtime organization UUID', 'runtimeId')}
                {values.edition === 'offline' &&
                  input('Offline installation UUID', 'installationId')}
              </div>
              {values.edition === 'offline' && (
                <label>
                  Import offline registration descriptor
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={reading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      mark(true);
                      setReading(true);
                      setError('');
                      void readJsonFile(file, 8192)
                        .then((data) => {
                          const descriptor =
                            offlineRegistrationSchema.safeParse(data);
                          if (!descriptor.success)
                            throw new Error(
                              'Choose an offline registration descriptor exported by the Billing workspace.',
                            );
                          if (active.current)
                            change({
                              name: descriptor.data.name,
                              runtimeId: descriptor.data.organizationId,
                              installationId: descriptor.data.installationId,
                            });
                        })
                        .catch((reason: unknown) => {
                          if (active.current)
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : 'The descriptor could not be read.',
                            );
                        })
                        .finally(() => {
                          if (active.current) setReading(false);
                        });
                    }}
                  />
                </label>
              )}
              <p className="muted">
                {values.edition === 'offline'
                  ? 'Import a descriptor or enter both host IDs. Imported identifiers are unverified metadata; review them before registration.'
                  : 'Create a new online organization, or link an existing one through a verified hosted lookup. Owner passwords are chosen on the customer setup page.'}
              </p>
              <button className="primary">
                {reading ? 'Reading file…' : 'Review organization'}
              </button>
            </>
          )}
        </fieldset>
      </form>
    </section>
  );
}
