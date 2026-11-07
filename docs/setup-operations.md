# Setup & system checks

This is the current entry point for setup diagnostics. New local profiles can use
[guided initial setup](guided-setup.md). Backup and Windows lifecycle interfaces
remain separate delivery batches in
[the implementation plan](system-setup-operations-plan.md).

## Local source checkout

In a PowerShell terminal, select the existing pinned toolchain, install locked
dependencies if needed, then inspect setup:

```powershell
& ./scripts/Use-ProjectToolchain.ps1
pnpm install --frozen-lockfile
pnpm setup:check
```

The checker reads configuration and validates syntax without changing files,
contacting a database or starting services. It prints codes and corrective
guidance, never configuration values. Exit code 1 means a prerequisite needs
attention. Both Billing and Admin configuration are checked; a missing Admin
configuration does not prevent running Billing independently.

If `pnpm` refuses to run because of engine versions, select the toolchain again
in that terminal. Selecting tools in one terminal does not change other terminals.
The checker requires installed development dependencies; it is not a customer
Windows installer or a replacement for installing Node/pnpm.

Use [README](../README.md) for customer development and
[Platform Admin](platform-admin.md#local-setup) for the existing protected Admin
setup sequence. Preserve existing files, keys, identities and database history.
Do not copy examples over existing configuration.

An offline Billing deployment is valid, but cannot provide online owner setup.
For Admin-managed SaaS onboarding, verify that the intended Billing deployment
uses `DEPLOYMENT_EDITION=saas` and the correct database and origin. Do not convert
an existing offline customer installation to resolve an onboarding warning.

## Admin operational checks

After signing in and completing MFA, open **Operations**. The **Setup & system
checks** card displays a timestamp, stable codes and corrective guidance.
**Refresh** runs new read-only checks; results are observations, not live monitoring.

The checks cover:

- Whether the platform control record permits worker processing.
- Whether a SaaS connection is configured and a catalog query succeeds.
- Expected database-name comparison, when independently configured using
  `SAAS_EXPECTED_DATABASE_NAME` in `.env.admin`.
- Required operator routines, EXECUTE/schema permissions, prohibited business
  table access, elevated roles, membership and ownership.
- Presence of a configured Billing origin and loaded trusted public keys.

The expected name check detects a wrong database name; it does **not** prove the
server, deployment, API edition, TLS identity or origin is correct. Independently
verify those during setup. The role checks are bounded prerequisites, not a full
database security audit. A successful probe never means a renewal or provisioning
request committed: those still require the existing operation receipt.

Checks do not migrate databases, grant permissions, change connection targets,
install licenses, invoke operator routines, read tenant records or resume workers.
No privileged action is available from this card. Host-only repairs use the
existing [SaaS connection runbook](platform-admin.md#connecting-a-saas-deployment).
After restore, follow its reconciliation procedure before enabling operations.

If PostgreSQL is down, inspect it on the host before retrying. A failed probe hides
database errors and connection details. If even platform authentication is
unavailable, use the local runbook/checker; this card cannot repair its own server.

The existing `/configuration` endpoint is retained for API compatibility:
`saasConnected` there historically means **configured only**. The new
authenticated `/api/platform/v1/diagnostics` endpoint and card provide observed
checks instead. No existing operation is newly blocked or enabled by diagnostics.

## Scope

These checks do not verify backups, restore recovery points, certificate files,
native installation/reboot/LAN behavior or production hosting. They require no
signing keys and do not change the postponed Windows release requirements.
