import { useState } from 'react';
import { z } from 'zod';
import type { Detail } from './types.js';
import { api, requestKey } from './api.js';
import { OperationList } from './components.js';

const observation = z.object({
  runtimeId: z.string().uuid(),
  setupComplete: z.boolean(),
  paused: z.boolean(),
});
export function hostedObservation(detail: Detail) {
  const parsed = observation.safeParse(detail.observation?.value);
  return parsed.success &&
    parsed.data.runtimeId === detail.organization.runtime_id
    ? parsed.data
    : null;
}
export function HostedPauseSummary({ detail }: { detail: Detail }) {
  const observed = hostedObservation(detail),
    request = detail.operations.find((op) => op.kind === 'pause');
  return (
    <div className="operation-summary">
      <p>
        {observed
          ? `Business writes were ${observed.paused ? 'paused' : 'not manually paused'} at the last hosted check (${new Date(String(detail.observation?.observed_at)).toLocaleString()}). License expiry, permissions and compliance still apply.`
          : 'Current hosted write-pause state has not been verified. Verify hosted status to check it.'}
      </p>
      {request && (
        <p>
          Latest pause/resume request:{' '}
          <a href={'#/operations/' + request.id}>
            {request.state} · {request.id.slice(0, 8)}
          </a>
          . A request is separate from the currently verified state.
        </p>
      )}
    </div>
  );
}
export function HostedOnboarding({
  detail,
  busy,
  save,
  run,
}: {
  detail: Detail;
  busy: boolean;
  save: (path: string, body: unknown) => Promise<unknown>;
  run: (action: () => Promise<unknown>) => Promise<unknown>;
}) {
  const [link, setLink] = useState<{
    url?: string;
    state?: string;
    operationId: string;
  } | null>(null);
  const org = detail.organization,
    base = 'organizations/' + org.id;
  const provision = detail.operations.find(
    (operation) => operation.kind === 'provision',
  );
  const observed = hostedObservation(detail);
  const provisioned = Boolean(observed || provision?.state === 'completed');
  const linkOperation = detail.operations.find(
    (operation) => operation.id === link?.operationId,
  );
  const expiry =
    linkOperation?.result &&
    typeof linkOperation.result === 'object' &&
    'expiresAt' in linkOperation.result &&
    typeof linkOperation.result.expiresAt === 'string'
      ? z
          .string()
          .datetime({ offset: true })
          .safeParse(linkOperation.result.expiresAt)
      : null;
  return (
    <section className="card">
      <h2>Hosted status and owner onboarding</h2>
      <ol className="onboarding-progress">
        <li>
          <strong>Directory record saved</strong>
          <p>
            Runtime organization: <code>{org.runtime_id}</code>. Commercial
            records do not activate access.
          </p>
        </li>
        <li>
          <strong>
            {observed
              ? 'Hosted identity verified at last check'
              : provisioned
                ? 'Provisioning receipt confirmed'
                : 'Hosted identity awaiting confirmation'}
          </strong>
          <p>
            {provision && provision.state !== 'completed'
              ? `Provisioning is ${provision.state}. Follow the existing operation instead of creating another organization.`
              : 'Verify hosted status before sharing setup access.'}
          </p>
          {provision && (
            <a href={'#/operations/' + provision.id}>
              View provisioning operation
            </a>
          )}
        </li>
        <li>
          <strong>
            {observed?.setupComplete
              ? 'Owner setup confirmed at last check'
              : 'Owner setup needs verification'}
          </strong>
          <p>
            New owners choose their own passwords. Existing users authenticate
            as the intended recipient; this page cannot replace their accounts.
          </p>
        </li>
        <li>
          <strong>Review licensed access separately</strong>
          <p>A payment or completed owner setup does not install a license.</p>
          <a href={`#/organizations/${org.id}/licenses`}>
            Open licenses and application status
          </a>
        </li>
      </ol>
      <button
        disabled={busy || Boolean(provision && provision.state !== 'completed')}
        onClick={() => void save(base + '/check', {}).catch(() => {})}
      >
        Verify hosted status
      </button>
      {!detail.observation && <p>Hosted status has not been verified yet.</p>}
      <HostedPauseSummary detail={detail} />
      <button
        disabled={busy || !observed || observed.setupComplete}
        onClick={() => {
          if (
            (link ||
              detail.operations.some(
                (operation) => operation.kind === 'setup_link',
              )) &&
            !confirm(
              'Generate a new owner setup link? This invalidates the previous link, including any copy already shared.',
            )
          )
            return;
          void run(async () => {
            const result = await api<{
              url?: string;
              state?: string;
              operationId: string;
            }>(base + '/setup-link', { requestKey: requestKey() });
            setLink(result);
          }).catch(() => {});
        }}
      >
        Generate owner setup link
      </button>
      {link?.url && (
        <label>
          Owner setup link
          <input
            readOnly
            value={link.url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      {link?.url && (
        <p role="status">
          {expiry?.success
            ? `Expires ${new Date(expiry.data).toLocaleString()}.`
            : 'Expires 24 hours after its billing database receipt; refresh to view the exact expiry.'}{' '}
          Keep this link private. It is displayed only in this page session and
          cannot be recovered later.
        </p>
      )}
      {link && !link.url && (
        <p role="status">
          Setup link operation is {link.state ?? 'pending'}.{' '}
          <a href={'#/operations/' + link.operationId}>
            Inspect this operation
          </a>{' '}
          before generating a replacement; the previous secret cannot be
          recovered.
        </p>
      )}
      <p className="muted">
        Links expire after 24 hours, are single use, and a replacement
        invalidates the previous link. If owner setup is complete, use normal
        account security/recovery instead.
      </p>
      {detail.operations.some(
        (operation) => operation.kind === 'setup_link',
      ) && (
        <OperationList
          operations={detail.operations
            .filter((operation) => operation.kind === 'setup_link')
            .slice(0, 1)}
          busy={busy}
          retry={(id) => save('operations/' + id + '/retry', {})}
        />
      )}
    </section>
  );
}
