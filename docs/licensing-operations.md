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
The host-only [recovery runtime permission command](runtime-database-access.md)
applies this column restriction as part of the reviewed API policy on a confirmed
quarantined copy; it does not activate the copy or install an entitlement.
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
subscription state, plus the publisher command below. Online activation/issuer service, self-service SaaS onboarding,
provider provisioning/renewal automation, commercial key custody/rotation and
verified hardware-transfer operations are unfinished.
An [offline update eligibility preflight](signed-releases.md#offline-maintenance-eligibility)
now checks current signed maintenance for every organization. Its future installer
integration is still unfinished; it does not affect perpetual billing rights.
No billing gateway, seat limits or pricing rules were invented. SaaS hosting has
not been selected. Customer invoice payment tracking remains out of scope.

Signature/expiry/binding/rollback unit tests and HTTP tests use ephemeral test
keys only. Production issuer keys or grants have not been created or installed.

## Publisher-only issuance and renewal

`scripts/issuer` is operator tooling, excluded from the Docker build context and
not imported by the customer API/web app. It does not generate or install private
keys. Provision an encrypted Ed25519 PKCS8 PEM key in restricted publisher storage,
with recovery/rotation controls and a separately reviewed public trust map.
Windows Authenticode keys and release-signing keys remain separate concerns.

Prepare an approved claims JSON matching `entitlementClaimsSchema`, with a new
entitlement UUID, the existing organization UUID and the proper host binding.
First issuance uses sequence 1. Trials must be exactly 14 days. For renewal or an
operator-approved installation transfer, supply the previous signed envelope, the
same organization/edition, a new entitlement UUID and exactly the next sequence.
Issuance time cannot precede the prior grant. A renewal cannot issue another trial.
SaaS grants must have a null installation ID. No seat/pricing rules are invented.

Inject `ISSUER_KEY_PASSPHRASE` through the publisher's protected process environment
or secret manager; do not put it in command arguments, customer `.env`, source
control or shell history. The command does not load the project `.env`.

Initialize a **new** authoritative register on protected local publisher storage,
outside customer installations, source control and cloud-sync/network folders.
Its parent must already exist and have safe permissions. Initialization creates
and secures only the new directory and refuses existing paths; incomplete
initialization requires inspection, not a reset. Save the returned register UUID
in protected publisher configuration, independently of customer identity.

```powershell
pnpm license:register init --register 'C:\Publisher-private\issuance-register'
pnpm license:issue --register 'C:\Publisher-private\issuance-register' --register-id <recorded-register-UUID> --claims 'C:\Publisher\approved-claims.json' --key-file 'C:\Publisher-private\issuer.pem' --key-id issuer-2026 --trust 'C:\Publisher\approved-public-keys.json' --output 'C:\Publisher\signed-grant.json' --new-organization
```

For subsequent grants replace `--new-organization` with
`--previous-grant 'C:\Publisher\previous-signed-grant.json'`. Keep the previous key's
public entry during a signing-key rotation so that grant can be authenticated.
The private key must match the approved public key for the selected key ID.
The output is checked through the real customer verifier before writing and never
overwrites an existing path. Output contains only the signed envelope; success and
failure logs omit claims, paths, keys and passphrases. Byte buffers are cleared on
exit, although JavaScript/OS memory erasure is not guaranteed. Provision directory
ACLs externally; POSIX output permissions do not secure Windows directories.

The CLI now requires that register and its expected UUID. It verifies the complete
per-organization signed history, requires the supplied predecessor to equal the
latest recorded envelope and rejects duplicate first issuance, sequence gaps and
stale renewals. Signing-key rotation must retain the historical approved public
keys needed to verify the chain within the current trust-store limit. An approved
host replacement continues the same organization sequence; it is not a new trial.

Each envelope is written and flushed privately, then committed under its sequence
using an atomic no-overwrite hard link. Concurrent attempts for the same next
sequence cannot both commit. Unsupported hard-link storage fails closed, without
a copy fallback. A grant is recorded **before** it is written to the delivery
output. If delivery fails or the command's reply is lost, inspect the register and
export that exact committed grant to a new path, without using the private key or
issuing another grant:

```powershell
pnpm license:register export --register 'C:\Publisher-private\issuance-register' --register-id <recorded-register-UUID> --organization <existing-organization-UUID> --sequence <committed-sequence> --trust 'C:\Publisher\approved-public-keys.json' --output 'C:\Publisher\recovered-signed-grant.json'
```

Output paths inside the register are refused. Strictly named unpublished
temporary files may survive an interruption; they are never delivered or used as
history, and are not automatically deleted. Malformed committed records, missing
intermediate records, unknown history files or wrong register identity block operations.
The root and organization directories are audited without silently repairing an
existing register's ACLs.

This is one publisher's local authority, not a replicated issuer service or a
tamper-proof commercial ledger. Never issue independently from copied/restored
registers. A privileged operator can delete a history tail or restore old storage;
the local register cannot detect that without an external authority. Protect and
back up the register, all historical public trust and key-custody records together.
Reconcile delivery/customer sequence evidence before resuming from a restored
backup; do not recreate the register or import a selected old grant as its head.
Automatic adoption of previously issued commercial history is not implemented.
Use this only for a new authority until any existing history is formally reconciled.

File contents are flushed and POSIX directories are synced. Windows directory
metadata/power-loss durability and deployment ACL acceptance remain native tests,
not claims inferred from passing local concurrency tests. Production register
storage, operator ownership/identity checks, key custody and backup procedures
still need an approved deployment. No production register or keys were created.
The customer continues independently to reject rollback against its installed
sequence. Hardware replacement needs commercial identity checks, protected recovery
of the existing database/configuration and issuer approval; disconnected old
copies cannot be instantly revoked. No self-service activation, subscription
provider or customer payment workflow is introduced.
