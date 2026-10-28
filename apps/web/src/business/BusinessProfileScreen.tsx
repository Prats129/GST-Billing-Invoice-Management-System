import { useEffect, useState } from 'react';
import {
  businessProfileInputSchema,
  businessProfileResponseSchema,
  businessProfileViewSchema,
} from '@gst/contracts';
import type { BusinessProfileView } from '@gst/contracts';
import { securityRequest } from '../security-api.js';
import { formText, formValues } from '../security-forms.js';
import { Badge, Icon } from '../ui.js';
import {
  AddressFields,
  FormError,
  SelectField,
  readAddress,
} from './shared.js';
import type { BusinessScreenProps } from './shared.js';
export function BusinessProfileScreen({
  basePath,
  permissions,
  busy,
  run,
  mutate,
}: BusinessScreenProps) {
  const [profile, setProfile] = useState<BusinessProfileView | null>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState(false);
  const canManage = permissions.includes('organization.manage');
  useEffect(() => {
    let active = true;
    setError('');
    void securityRequest(`${basePath}/business-profile`, undefined)
      .then((data) => {
        if (active)
          setProfile(businessProfileResponseSchema.parse(data).profile);
      })
      .catch(() => {
        if (active)
          setError(
            'Business setup could not be loaded. Try again or refresh access.',
          );
      });
    return () => {
      active = false;
    };
  }, [basePath, attempt]);
  if (profile === undefined)
    return (
      <section className="surface">
        <FormError message={error} />
        {error ? (
          <button
            className="button button-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        ) : (
          <p role="status">Loading business setup…</p>
        )}
      </section>
    );
  const current = profile ?? undefined;
  return (
    <>
      <section className="surface business-profile">
        <div className="section-heading">
          <div>
            <h2>Your business details</h2>
            <p>
              Use the legal name and principal address on your registration.
            </p>
          </div>
          <Badge tone={profile?.registrationConfirmed ? 'green' : 'amber'}>
            {profile?.registrationConfirmed
              ? 'Details confirmed by your team'
              : 'Registration needs review'}
          </Badge>
        </div>
        {saved && (
          <p className="success-note" role="status">
            <Icon name="check" size={17} />
            Business details saved.
          </p>
        )}
        <FormError message={error} />
        <form
          key={profile?.version ?? 0}
          onSubmit={(event) => {
            const data = formValues(event);
            setSaved(false);
            setError('');
            const values = Object.fromEntries(
              [
                'legalName',
                'tradeName',
                'email',
                'phone',
                'gstin',
                'eInvoiceApplicability',
                'bankName',
                'bankAccountName',
                'bankAccountNumber',
                'bankIfsc',
              ].map((key) => [key, formText(data, key)]),
            );
            const parsed = businessProfileInputSchema.safeParse({
              ...values,
              version: profile?.version ?? 0,
              address: readAddress(data),
              taxpayerType: 'regular',
              registrationConfirmed: data.has('registrationConfirmed'),
            });
            if (!parsed.success) {
              setError(
                parsed.error.issues[0]?.message ??
                  'Check the business details.',
              );
              return;
            }
            void run(async () => {
              const next = businessProfileViewSchema.parse(
                await mutate(
                  `${basePath}/business-profile`,
                  parsed.data,
                  'PUT',
                ),
              );
              setProfile(next);
              setSaved(true);
            });
          }}
        >
          <fieldset className="form-section" disabled={!canManage || busy}>
            <legend>Business identity</legend>
            <div className="form-grid">
              <label>
                Legal business name
                <input
                  name="legalName"
                  required
                  maxLength={200}
                  defaultValue={current?.legalName}
                />
              </label>
              <label>
                Trade name
                <input
                  name="tradeName"
                  maxLength={200}
                  defaultValue={current?.tradeName}
                />
              </label>
              <label>
                Contact email
                <input
                  name="email"
                  type="email"
                  maxLength={254}
                  defaultValue={current?.email}
                />
              </label>
              <label>
                Contact number
                <input
                  name="phone"
                  type="tel"
                  maxLength={25}
                  defaultValue={current?.phone}
                />
              </label>
            </div>
            <AddressFields {...(current ? { address: current.address } : {})} />
            <div className="form-grid">
              <label>
                GSTIN
                <input
                  name="gstin"
                  required
                  minLength={15}
                  maxLength={15}
                  defaultValue={current?.gstin}
                  autoCapitalize="characters"
                />
              </label>
              <SelectField
                label="E-invoice applicability"
                name="eInvoiceApplicability"
                value={current?.eInvoiceApplicability ?? 'unknown'}
              >
                <option value="unknown">Not assessed yet</option>
                <option value="required">Required for this business</option>
                <option value="not_required">
                  Not required — assessed by our team
                </option>
              </SelectField>
            </div>
            <div className="info-note">
              <Icon name="info" size={18} />
              <p>
                This setup supports regular domestic GST businesses. Check
                registration details on the{' '}
                <a
                  href="https://services.gst.gov.in/services/searchtp"
                  target="_blank"
                  rel="noreferrer"
                >
                  official GST portal
                </a>
                . A format check does not confirm registration status or legal
                tax treatment.
              </p>
            </div>
            <label className="check">
              <input type="checkbox" name="registrationConfirmed" />
              <span>
                I have checked the registration status, taxpayer type, legal
                name and address.
                <small>
                  Confirm again when saving. This records your team's review.
                </small>
              </span>
            </label>
            <details className="bank-settings">
              <summary>Bank details (optional)</summary>
              <div className="form-grid">
                <label>
                  Bank name
                  <input
                    name="bankName"
                    maxLength={120}
                    defaultValue={current?.bankName}
                  />
                </label>
                <label>
                  Account holder name
                  <input
                    name="bankAccountName"
                    maxLength={120}
                    defaultValue={current?.bankAccountName}
                  />
                </label>
                <label>
                  Account number
                  <input
                    name="bankAccountNumber"
                    inputMode="numeric"
                    pattern="[0-9]{0,34}"
                    maxLength={34}
                    defaultValue={current?.bankAccountNumber}
                  />
                </label>
                <label>
                  IFSC
                  <input
                    name="bankIfsc"
                    maxLength={11}
                    defaultValue={current?.bankIfsc}
                  />
                </label>
              </div>
            </details>
          </fieldset>
          <div className="card-footer">
            <span className="muted">
              {canManage
                ? 'Your changes are recorded in the activity log.'
                : 'You have read-only access to these details.'}
            </span>
            {canManage && (
              <button className="button button-primary" disabled={busy}>
                <Icon name="check" size={16} />
                Save business details
              </button>
            )}
          </div>
        </form>
      </section>
      <div className="info-note">
        <Icon name="shield" size={18} />
        <p>
          Assess e-invoice applicability for your business before issuing
          invoices.
        </p>
      </div>
    </>
  );
}
