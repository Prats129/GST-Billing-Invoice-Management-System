# Platform Admin

The publisher portal manages software customers, agreed charges and signed license
handoffs. It is separate from the customer billing application and contains no
customer invoices, catalog or customer-directory records. There is one platform
owner in this version. Organization ownership never confers platform access.

## Local setup

Use the pinned project toolchain in a new PowerShell terminal:

```powershell
& ./scripts/Use-ProjectToolchain.ps1
pnpm install --frozen-lockfile
Copy-Item .env.admin.example .env.admin
```

Prepare a **new separate PostgreSQL database**, for example `gst_platform_dev`.
Do not point the platform migration command at the customer database: it refuses
that target. Existing Docker PostgreSQL can host the separate database. Provision
an owning migration account and a separate non-owning login role for the platform
API. Keep runtime credentials in `.env.admin` and migration credentials in
`.env.admin.operator`, both ignored and protected by NTFS permissions. Do not
change the customer's `.env` or reuse its runtime identity.

For the existing local development container, open an interactive database console:

```powershell
docker exec -it gst-billing-invoice-management-system-postgres-1 psql -U gst_dev -d postgres
```

Run these only for a **new** platform database. Choose unique private passwords at
the masked `\password` prompts; do not put passwords in command arguments/history:

```sql
CREATE ROLE platform_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password platform_migrator
CREATE ROLE platform_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password platform_runtime
CREATE DATABASE gst_platform_dev OWNER platform_migrator;
REVOKE CONNECT, TEMPORARY ON DATABASE gst_platform_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE gst_platform_dev TO platform_runtime;
\quit
```

If those names already exist, inspect them instead of replacing accounts or data.
Use `platform_migrator` in the private migration URL and `platform_runtime` in the
API URL. The database console above is for this repository's local Docker setup;
production role creation belongs to the selected hosting/operator environment.

Set `PLATFORM_AUTH_KEY` to a private, cryptographically random 32-byte hex key.
This encrypts the owner's TOTP secret and is **not** a commercial signing key.
Preserve it in protected recovery storage. Configure the runtime URL in `.env.admin`. Put `PLATFORM_MIGRATION_DATABASE_URL`
in a separate protected `.env.admin.operator` file, then migrate:

```powershell
pnpm admin:db:migrate
```

Prepare a private JSON input containing only the existing restricted runtime
role's name, then grant the reviewed platform permissions:

```json
{ "role": "platform_runtime" }
```

```powershell
pnpm admin:owner runtime-role C:\Publisher-private\runtime-role.json
```

Prepare another private input containing `email`, `name` and a unique `password`
of at least 15 characters. Bootstrap the singleton owner:

```powershell
pnpm admin:owner provision C:\Publisher-private\owner-input.json C:\Publisher-private\owner-recovery.jsonl
pnpm dev:admin
```

Open **http://127.0.0.1:5174**. The platform API uses port **3001**; both ports
are strict and independent of customer ports 5173/3000. Complete authenticator
enrollment and save the one-time recovery codes before using the directory.
Remove the password input safely after bootstrap. Output files are created
exclusively and never overwritten. Their prepared recovery proof is flushed
before the database operation, including when the commit reply is lost.

These commands prepare no production signing key, Windows service, certificate
trust or customer installation. Production requires HTTPS and a protected admin
origin. `PLATFORM_ENV_FILE` can select an alternate private environment file;
the default is `.env.admin` at the repository root.

## Connecting a SaaS deployment

The SaaS database must have the reviewed customer migrations through
`0007_platform_operator`. A separate operator role receives **only** USAGE on
`platform_operator` and EXECUTE on its two allow-listed routines. Those routines
use a fixed search path, revoke PUBLIC execution and return bounded metadata or
committed operation receipts. The role must not own objects or have customer
business-table access. Do not use the migration connection in the running portal.

Set `SAAS_MIGRATION_DATABASE_URL` only in `.env.admin.operator` or the protected operator environment and
prepare `{"role":"saas_operator"}` as a private input:

```powershell
pnpm admin:owner saas-role C:\Publisher-private\saas-role.json
```

Configure `SAAS_OPERATOR_DATABASE_URL` and the exact `SAAS_APP_ORIGIN`. The
customer runtime role needs SELECT on `organization_write_controls` and SELECT/
UPDATE on `owner_setup_tokens`, in addition to its existing reviewed permissions.
It does **not** receive license-installation rights or platform-operator execution.
Use the existing controlled runtime-permission provisioning procedure.

Operation processing starts disabled. After verifying the authority, SaaS target
and any restored history, prepare `{"acknowledgeReconciled":true}` and explicitly
enable it:

```powershell
pnpm admin:owner enable-operations C:\Publisher-private\reconciled.json
```

The portal remains usable for directory/commercial records when SaaS is absent.
Operations stay pending or retryable; this does not activate access. Each operation
keeps the same UUID through retries. SaaS commits the operation receipt and the
change together; a lost response is reconciled against that receipt rather than
re-provisioning or minting a license. Conflicts require inspection, not changing
the saved payload or resetting history. Retries preserve per-organization order.

## Daily workflows

1. Add an online organization or verify/link an existing online organization.
   Offline records require the actual host organization and installation UUIDs.
   One installation can contain several organizations.
2. New online organizations appear pending. Once provisioning completes, confirm
   your identity in **Account security**, then generate the 24-hour owner link and
   share it privately. Regeneration invalidates the previous link. A lost secret
   cannot be recovered: generate a new one. Existing SaaS users authenticate as
   themselves and complete normal MFA; their passwords are never replaced.
3. Use **Verify hosted status** after setup or access changes. The displayed
   timestamp is an observation, not a continuous health/telemetry feed. Directory
   archiving changes metadata only and does not suspend customer access.
4. Record exact agreed dates and INR totals. Receipts may be partial but cannot
   exceed the outstanding balance. Refund/reversal entries preserve the original
   receipt. Reverse net receipts before voiding an agreement, then create the
   corrected replacement. These are internal records, not GST tax invoices.
5. Reconcile the complete signed history, prepare immutable claims, export them,
   and use the existing [publisher register and signing tools](licensing-operations.md).
   The publisher register remains the sole signing authority. Signing happens in
   encrypted offline storage, outside this portal; private keys are never uploaded.
6. Import the signed envelope against the frozen request. Initial adoption uses
   ordered, fully verified history, in batches of at most 100 grants. Same-sequence
   conflicts, gaps, unknown keys and wrong bindings fail closed. No new trial or
   installation transfer is created by reconciliation.
7. Confirm identity before applying the latest grant to SaaS. Applying a future
   or expired grant replaces the current grant and may immediately make writes
   read-only. It is not automatically scheduled for a later start date. Inspect
   the operation and verify hosted status before telling the customer it is active.
8. For offline customers, download the signed file and install it using existing
   host tooling. Record delivery separately from an operator's installation report.
   Neither report is live verification, synchronization or immediate revocation.

A payment never automatically enables or disables access. Trials last exactly
14 days; time-limited expiry immediately makes business writes read-only.
Maintenance expiry does not expire perpetual billing rights. A manual SaaS pause
also blocks business writes, while authorized historical viewing/printing and
security administration remain available. Resume removes only that pause; it
does not override an expired entitlement, RBAC or invoice compliance rules.

Directory results are paginated in batches of 50. Organization detail sections
show the latest 100 entries per category; their totals are calculated from the
complete ledger, not the visible rows. Preserve the platform database as the
complete commercial/audit history; it is independent of customer backups.

## Account recovery and deployment

Recovery requires both protected host/operator access and the one-time bootstrap
recovery credential. Put `recoveryCredential` and the new `password` in a private
input, then run `admin:owner recover <input> <new-exclusive-output>`. This rotates
the host proof, revokes every browser session and recovery code, removes the old
authenticator and requires MFA enrollment again. There is no web recovery bypass.

Production rejects migration credentials in its runtime environment. The operator
CLI reads `.env.admin.operator` separately; keep that file inaccessible to the
running API service identity.

Production serves the built admin UI from the admin API at one HTTPS origin using
`PLATFORM_WEB_ROOT`, `PLATFORM_TLS_KEY` and `PLATFORM_TLS_CERT`. Run
`pnpm build` and `pnpm start:admin` under the chosen process supervisor. The
origin/Host checks and secure host-only cookie must remain intact. Do not expose
PostgreSQL or share customer cookies, MFA keys, credentials or static roots.
The API description is available at `/api/platform/openapi.json`.

## Backups, restore and reconciliation

Back up the separate platform database using PostgreSQL custom-format dumps,
encrypted storage, restricted access and an off-device copy. Protect the TOTP
encryption key separately. Also back up the independent publisher register,
historical public trust and key-custody records; a platform backup is not an
issuer-authority backup. Set retention only after choosing production hosting.

Before restoring: stop the admin API/worker, retain the original database and
restore into a **new separate database** using `pg_restore --no-owner --no-privileges`.
Reapply reviewed runtime-role grants. Set
`UPDATE platform_control SET operations_enabled=false` **before any worker starts**.
Reconcile SaaS committed operation receipts, actual installed sequences, delivered
offline grants and the authoritative publisher register. Never roll back the
SaaS database just to match an older platform backup, reissue signed grants or
erase a conflicting history tail. Verify pending-operation payloads and preserve
unknown outcomes for inspection. Use the explicit enable command only after this
review. Restored admin sessions should be revoked before admitting browser access.

The isolated integration drill exercises real `pg_dump`/`pg_restore`, authenticated
encryption and history preservation, with operation processing quarantined after
restore. It does not certify a production backup provider or retention policy.

## Verification and remaining external inputs

Run the repository unit/integration/browser checks. Integration and browser tests
create only randomly named disposable databases. The backup drill additionally
uses `TEST_BACKUP_DOCKER_CONTAINER` for PostgreSQL client tools. Production keys,
real customer records and privileged Windows installer actions are not used.

Hosting, production DNS/TLS, secure signing storage/keys, retention and the
postponed Windows host/client acceptance tests remain external release work.
Do not treat a locally passing portal as a completed commercial deployment.
