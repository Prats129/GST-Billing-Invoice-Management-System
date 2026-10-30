# Signed entitlements and subscription state

Phase 6 host/platform-operator implementation. Windows executable code signing
and entitlement signing are separate: commercial license grants use an external
Ed25519 issuer, not a Windows code-signing certificate. No issuer private key is
embedded, generated in a customer API, or committed to this repository.

## Confirmed behavior

- A trial lasts exactly 14 days. At the expiry instant, trials and time-limited
  subscriptions immediately become read-only, with **no grace period**, as chosen
  by the user on 2026-10-30.
- Perpetual offline grants have no entitlement expiry. Optional maintenance expiry
  does not remove billing rights. Maintenance eligibility is not an update bypass.
- Offline grants bind a persistent installation UUID and one organization. SaaS
  grants bind an organization and must not bind a host. A user membership is never
  itself a subscription. Different organizations require separate signed grants.
- Missing/invalid/expired/wrong-host/wrong-tenant/not-yet-valid grants, decreased
  sequences and observed clock rollback block business-data writes. Authorized
  historical reads/printing remain available. Security administration stays
  available for revocation and account recovery. RBAC/CSRF/MFA remain independent.
- Production fails closed without a trust store. Unconfigured development/test
  workspaces remain explicitly unlicensed, so existing local work is preserved.
  Configuring a trust store enables enforcement in development for verification.
- Expiry does not delete or recreate customer records. Renewal installs a higher
  signed sequence in the existing organization, preserving its data and identity.
- The invoice compliance/IRP gates remain independent and cannot be bypassed by
  any valid license/subscription.

## Trust and host installation

`ENTITLEMENT_TRUST_FILE` is an absolute path to a protected JSON map of approved
key IDs to Ed25519 SPKI **public** PEM keys. Up to ten active keys allow controlled
issuer rotation. Protect both this file and the application/configuration against
unprivileged modification. A host administrator with full machine/database
control cannot be made unable to modify a fully offline application.

For offline installations, set `OFFLINE_INSTALLATION_ID` to the persistent UUID
recorded by deployment. Do not rotate it on browser login, reboot or backup.
Hardware/installation transfers require issuer-approved replacement grants; no
transfer self-service or immediate offline revocation is claimed.

The issuer supplies a JSON envelope `{keyId,payload,signature}`. Payload and
signature use canonical unpadded base64url. The Ed25519 signing message is UTF-8
`GST-ENTITLEMENT-V1\n<keyId>\n<payload>`. Claims are defined in
`packages/contracts/src/entitlements.ts`; all unknown fields are rejected. Use
monotonically increasing sequences **per organization**, including renewals and
replacement grants. A same-sequence identical envelope is an idempotent retry;
same-sequence different contents and lower sequences are rejected.

From a protected operator environment configured with trusted public keys,
installation UUID (offline), and `MIGRATION_DATABASE_URL`:

```powershell
pnpm db:migrate
pnpm license:install 'C:\GST-private\signed-grant.json'
```

The host CLI verifies signatures and binding, locks the same organization row as
business writes, installs atomically and appends an audit event. There is no
tenant-facing endpoint to install grants or mint trials. An installed future or
expired grant is reported as such and does not enable writes. The envelope is
not a login credential and grants no RBAC permission.

The API role needs `SELECT` on `organization_entitlements` and only column-level
`UPDATE (last_observed_at)` on that table. Do **not** grant it INSERT, DELETE or
UPDATE of `signed_grant`/`highest_sequence`. Use the operator connection for
installation. Existing grants are deliberately not broadened by migration 0005.
Application code still verifies every business mutation even if a local
development connection owns the database.

The workspace shows a read-only notice for failed/expired entitlement states.
Business forms and invoice mutation controls honor that state without changing
the user's actual RBAC grants; security administration and reads remain available.
Business writes return `ENTITLEMENT_READ_ONLY` without signing the user out.
Refresh access after renewal to update the notice; every server mutation checks
the current grant independently of that UI notice.

## Boundaries still requiring release work

Clock tracking records the last successful business-write/import observation.
It detects rollback against that marker; it cannot guarantee perfect clock
tamper protection or resist restoring an entire older machine/database image.
Read-only/failed operations do not commit a new clock marker. Do not advertise
immediate offline revocation or tamper-proof licensing.

This implements signed-file activation and a provider-neutral signed SaaS
subscription state. Online activation/issuer service, self-service SaaS onboarding,
provider provisioning/renewal automation, commercial key custody/rotation,
hardware-transfer workflow and maintenance-gated signed updates are unfinished.
No billing gateway, seat limits or pricing rules were invented. SaaS hosting has
not been selected. Customer invoice payment tracking remains out of scope.

Signature/expiry/binding/rollback unit tests and HTTP tests use ephemeral test
keys only. Production issuer keys or grants have not been created or installed.
