import type { PlatformDiagnostics } from '@gst/contracts/platform';

export const diagnosticGuidance: Record<
  PlatformDiagnostics['checks'][number]['code'],
  string
> = {
  WORKER_ENABLED: 'Operation processing is enabled.',
  WORKER_DISABLED:
    'Operation processing is paused. The host operator must complete reconciliation and enable operations using the Platform Admin runbook. Do not enable processing merely to dismiss this warning.',
  PLATFORM_CONTROL_UNAVAILABLE:
    'Worker status could not be read. Ask the host operator to check platform migrations, connection and runtime permissions.',
  SAAS_NOT_CONFIGURED:
    'Online operations are not configured. The host operator must configure the restricted SaaS connection in .env.admin. Offline directory records remain available.',
  SAAS_REACHABLE: 'The configured database answered a read-only probe.',
  SAAS_TARGET_UNCONFIRMED:
    'The database target is not confirmed. The host operator must independently identify the SaaS database, then set SAAS_EXPECTED_DATABASE_NAME in .env.admin and restart the Admin API.',
  SAAS_TARGET_MATCHED:
    'The database name matches the configured expected target. This does not verify the billing API edition, origin or deployment identity.',
  SAAS_TARGET_MISMATCH:
    'The connection points to an unexpected database name. Ask the host operator to review the SaaS connection and expected target. Do not provision or apply grants until corrected.',
  SAAS_MIGRATIONS_REQUIRED:
    'Required operator routines are missing. The host operator must verify the target, then run billing migrations with migration credentials.',
  SAAS_PERMISSIONS_REQUIRED:
    'Operator permissions are missing. The host operator must grant only the reviewed permissions using admin:owner saas-role, following the Platform Admin runbook.',
  SAAS_ROLE_UNSAFE:
    'The operator connection has excessive privileges. Replace it with the restricted non-owning operator role; never use migration or superuser credentials in the Admin API.',
  SAAS_OPERATOR_READY:
    'Required operator routines and the checked role restrictions are present. This is a prerequisite check, not a complete privilege audit or proof that a request was applied.',
  SAAS_PROBE_FAILED:
    'The SaaS probe failed. Ask the host operator to check PostgreSQL availability, connection credentials, TLS and catalog permissions. Private connection details are not displayed.',
  SAAS_ORIGIN_CONFIGURED:
    'A billing origin is configured. Open a generated setup link only after verifying that it reaches the intended SaaS billing deployment.',
  SAAS_ORIGIN_MISSING:
    'The billing origin is missing. The host operator must set SAAS_APP_ORIGIN to the exact SaaS billing origin in .env.admin and restart the Admin API.',
  TRUST_CONFIGURED:
    'Trusted public signing keys are loaded. Private signing keys stay outside this application.',
  TRUST_MISSING:
    'No trusted public signing keys are loaded. The host operator must configure PLATFORM_TRUST_FILE using the publisher-approved public trust file, then restart the Admin API.',
};

export function Diagnostics({ value }: { value: PlatformDiagnostics }) {
  return (
    <section className="card" aria-labelledby="diagnostics-heading">
      <h2 id="diagnostics-heading">Setup & system checks</h2>
      <p>
        Checked {new Date(value.checkedAt).toLocaleString()}. Use Refresh to
        check again. These checks do not change configuration, resume operations
        or verify a customer installation.
      </p>
      <ul>
        {value.checks.map((check) => (
          <li key={check.code}>
            <strong>
              {check.state === 'ready' ? 'Passed' : 'Action needed'}
            </strong>
            {' · '}
            {diagnosticGuidance[check.code]}
            <small> ({check.code})</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
