import { useEffect, useState } from 'react';
import { workspaceSetupSchema } from '@gst/contracts';
import type {
  WorkspaceSetup as Setup,
  OrganizationAccess,
  SessionInfo,
} from '@gst/contracts';
import { downloadJson } from '@gst/ui/json-files';
import { securityRequest } from './security-api.js';
import { canOpenView } from './workspace-navigation.js';
import type { View } from './workspace-navigation.js';

export function WorkspaceSetup({
  context,
  info,
  navigate,
}: {
  context: OrganizationAccess;
  info: SessionInfo;
  navigate: (view: View) => void;
}) {
  const [value, setValue] = useState<Setup | null>(null);
  const [open, setOpen] = useState(false);
  const businessHelp = context.access.permissions.includes(
    'organization.manage',
  )
    ? ''
    : ' Ask your organization owner to make changes.';
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || !context.access.permissions.includes('organization.read'))
      return;
    let active = true;
    setLoading(true);
    setError('');
    setValue(null);
    void securityRequest(
      `/organizations/${context.organization.id}/setup-status`,
      undefined,
    )
      .then((result) => {
        const parsed = workspaceSetupSchema.parse(result);
        if (active) setValue(parsed);
      })
      .catch(() => {
        if (active)
          setError(
            'Workspace checks could not be loaded. Retry to check the current setup.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [context.organization.id, context.access.permissions, attempt, open]);
  const row = (
    title: string,
    detail: string,
    state: 'complete' | 'attention' | 'review',
    view: View,
  ) => (
    <li>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <span className="setup-state">
        {state === 'complete'
          ? 'Checked'
          : state === 'attention'
            ? 'Action needed'
            : 'Review'}
      </span>
      {canOpenView(view, context.access.permissions) && (
        <button
          className="button button-secondary"
          onClick={() => navigate(view)}
        >
          Open{' '}
          {view === 'security'
            ? 'account security'
            : view === 'business'
              ? 'business setup'
              : view}
        </button>
      )}
    </li>
  );
  if (!context.access.permissions.includes('organization.read')) return null;
  return (
    <details
      className="surface workspace-setup"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Workspace setup checklist</summary>
      <p>
        Check prerequisites and open the place to fix them. Invoice validation
        still runs when you calculate or finalize.
      </p>
      <button
        className="button button-secondary"
        disabled={loading}
        onClick={() => setAttempt((v) => v + 1)}
      >
        {loading ? 'Checking setup…' : 'Refresh setup checks'}
      </button>
      {error && <p role="status">{error}</p>}
      {value && (
        <>
          <p className="muted">
            Checked {new Date(value.checkedAt).toLocaleString()}. These are
            observations, not approval to issue an invoice.
          </p>
          <ul>
            {row(
              'Account security',
              info.mfaEnabled
                ? 'Authenticator enabled.'
                : info.mfaMandatory
                  ? 'Authenticator setup is required.'
                  : 'Authenticator is optional for this account. Review your security settings.',
              info.mfaEnabled ? 'complete' : 'review',
              'security',
            )}
            {row(
              'Business and GST registration',
              !value.businessConfigured
                ? 'Save your business details first.' + businessHelp
                : !value.registrationConfirmed
                  ? 'Confirm the GST registration details in Business setup.' +
                    businessHelp
                  : 'Business details and GST confirmation are saved.',
              value.businessConfigured && value.registrationConfirmed
                ? 'complete'
                : 'attention',
              'business',
            )}
            {row(
              'Invoice issuance scope',
              value.issuanceBlockers.length
                ? value.issuanceBlockers.join(' ') + businessHelp
                : 'Ordinary invoice policy checks passed. Each invoice still needs its own validation.',
              value.issuanceBlockers.length ? 'attention' : 'complete',
              'business',
            )}
            {row(
              'Customers',
              value.customersPresent === null
                ? 'Your permissions do not allow checking customer records. Ask your organization owner.'
                : value.customersPresent
                  ? 'An active customer exists. Choose the correct customer when billing.'
                  : context.access.permissions.includes('customers.manage')
                    ? 'Add a customer to use in your invoice.'
                    : 'Ask a customer manager to add a customer for billing.',
              value.customersPresent ? 'complete' : 'review',
              'customers',
            )}
            {row(
              'Catalog and tax classification',
              value.catalogPresent === null
                ? 'Your permissions do not allow checking catalog records. Ask your organization owner.'
                : value.catalogPresent
                  ? 'Review each item’s classification for the actual supply date. Item presence does not confirm tax review.'
                  : context.access.permissions.includes('catalog.manage')
                    ? 'Add an item and review its tax classification before billing.'
                    : 'Ask a catalog manager to add an item and an authorized reviewer to verify its classification.',
              'review',
              'catalog',
            )}
            {row(
              'License and write access',
              value.entitlement.businessWritesPaused
                ? 'Your provider has paused business changes. Authorized historical viewing remains available; contact your provider.'
                : value.entitlement.status === 'active'
                  ? 'The license is active. Your permissions and invoice compliance checks still apply.'
                  : value.entitlement.status === 'development'
                    ? 'Development access only; this does not prove production license readiness.'
                    : `License status: ${value.entitlement.status.replaceAll('_', ' ')}. Contact your provider to review access.`,
              value.entitlement.status === 'active' &&
                !value.entitlement.businessWritesPaused
                ? 'complete'
                : 'attention',
              'system',
            )}
            {row(
              'Team access',
              context.access.permissions.includes('members.manage')
                ? 'Add members only if needed, and review what each role can do. Licenses never grant team permissions.'
                : 'Review team access with your organization owner. Licenses never grant team permissions.',
              'review',
              'members',
            )}
          </ul>
          {value.offlineRegistration && (
            <div className="setup-export">
              <p>
                Share this organization’s registration descriptor with your
                provider. It contains identifiers and the organization name, not
                invoices or credentials. Importing it does not verify
                installation or activate a license.
              </p>
              <button
                className="button button-secondary"
                onClick={() =>
                  downloadJson(
                    'offline-registration.json',
                    value.offlineRegistration,
                  )
                }
              >
                Export offline registration
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}
