# GST billing platform

Shared Windows offline and SaaS billing platform under development. Phase 1 provides
the technical foundation; Phase 2 adds login, sessions, MFA, organization memberships
and permission-based administration. Phase 3 adds business/GST setup, customers
and a product/service catalog with classification review. Phase 4 adds a pure,
decimal-safe GST calculation preview library. Phase 5 adds the invoice workspace,
saved drafts, server calculation, value corrections, cancellation, logos and A4
printing. Ordinary domestic invoice issuance is enabled following the owner's
confirmation of CA approval. E-invoicing, correction-note issuance and issued
cancellation remain gated; no blanket legal-compliance or production-readiness
claim is made.

## Publisher administration

A separate owner-only Platform Admin app manages online/offline organizations,
software agreements/receipts, external signing handoffs and approved SaaS operations.
It has its own database, credentials and MFA; customer ownership grants no platform
access. See [Platform Admin setup and operations](docs/platform-admin.md).
For organization onboarding, workspace checks, license handoffs and operation
history, see [guided daily workflows](docs/daily-workflows.md).
Use `pnpm dev:admin` after the separate database/owner setup. The existing `pnpm dev`
continues to run only the customer application.
Apply the reviewed customer migration with `pnpm db:migrate` before starting the
updated customer API; its readiness checks require the new control/setup tables.

## Prerequisites

- A currently patched Node 24 LTS (`.nvmrc`: 24.22.1) and pnpm 10.34.9.
  `npm install --global pnpm@10.34.9` if pnpm is unavailable.
- Docker Desktop/Engine running with Linux containers for PostgreSQL 18.6,
  or your own dedicated local PostgreSQL 18 instance. PostgreSQL must bind only
  to loopback; never expose its port to LAN clients.
- Windows PowerShell 5.1+ for the optional deployment spike.
- Certificate tests use an installed OpenSSL executable (system `openssl` on Linux,
  Git for Windows' `C:\Program Files\Git\usr\bin\openssl.exe` by default).
  Set `TEST_OPENSSL_PATH` if your trusted installation is elsewhere. These tests
  generate temporary keys/certificates and never import machine certificate trust.
  Running the application itself does not require the OpenSSL command-line tool.

Version choices: NestJS 12 (provisional Express), Vite 8/React 19, TypeScript 6,
Drizzle ORM 0.45 and PostgreSQL 18. Exact dependency resolutions are locked in
pnpm-lock.yaml. Phase 6 requires Node 24.22.1+ within major 24 and pnpm 10.34.9;
the workspace engine checks reject the older host tools before installation.
Node 22.13.0 crashed loading the Windows Argon2 prebuild on this development host;
the same binary passed native loading/hash verification with Node 24.22.1.
See [runtime support](https://nodejs.org/en/about/previous-releases),
[Nest requirements](https://docs.nestjs.com/migration-guide),
[Vite requirements](https://vite.dev/guide/) and
[PostgreSQL support](https://www.postgresql.org/support/versioning/).

## Local startup

For a **new isolated local profile**, use the
[guided setup assistant](docs/guided-setup.md):
`& ./scripts/Setup-Project.ps1`. It prepares dependencies, databases, restricted
roles, settings and the initial owner without hand-written SQL/password JSON.
Existing installations can keep using the commands below; guided setup never
adopts or overwrites their databases/configuration. Daily profile startup is
`pnpm setup:launch`.

On Windows, this checkout can select its existing compatible cached tools:

```powershell
.\scripts\Use-ProjectToolchain.ps1
```

The helper prepares an ignored `.local/toolchain` using existing Node/pnpm
distributions, then selects it for that PowerShell session. It does not download
tools or replace system installations. On a fresh clone without compatible cached
tools, install the prerequisites first. An existing local toolchain is validated
and reused, never silently overwritten.

The workspace [VS Code terminal configuration](.vscode/settings.json) selects this
prepared toolchain for new Windows terminals. Close older terminals and create a
new one after setup; already-running terminals retain their old environment.
Outside VS Code, run the helper in each new PowerShell session. This uses VS Code's
[terminal environment setting](https://code.visualstudio.com/docs/terminal/profiles).

From the project root:

```sh
pnpm install --frozen-lockfile
pnpm setup:env
pnpm db:up
pnpm db:migrate
pnpm dev
```

`setup:env` generates `.env` with a random local password and MFA encryption key.
For an existing file, it adds only a missing AUTH_DATA_KEY and preserves existing
settings/credentials. Alternatively copy `.env.example` and replace every
password placeholder consistently. For an existing PostgreSQL instance, adjust
both URLs to a dedicated development database and the correct loopback port.
URL-encode reserved password characters. Docker bootstrap credentials have
development-only superuser privileges; production must use distinct migration
and restricted runtime roles. Keep secrets out of logs and source control.
On Windows, file creation mode does not configure NTFS ACLs; keep the checkout
within your private user directory or restrict `.env` access explicitly. The
Windows deployment spike uses protected directories for service secrets.

Open **http://localhost:5173**. The shell requests `/api/v1/health` and
`/api/v1/health/ready` through Vite's same-origin proxy. API listens on
127.0.0.1:3000; Vite on 127.0.0.1:5173. No LAN development HTTP exposure.
The UI shows API connected and PostgreSQL ready only when each check succeeds.
There is no default login or public administrator setup. Follow
[first-owner setup](docs/identity-operations.md#first-owner-no-default-account)
to provision your organization using a private input file, then sign in.
Ctrl+C stops dev processes. `pnpm db:down` stops containers while retaining data.
Do not use `docker compose down -v` unless deliberately destroying local data.

API routes:

- `GET /api/v1/health`: liveness, independent of DB.
- `GET /api/v1/health/ready`: 200 with migrated database, otherwise sanitized 503.
- `GET /api/openapi.json`: OpenAPI document; no Swagger UI/CSP relaxation.
- `/api/v1/auth/*`: sessions, passwords, TOTP and recovery-code management.
- `/api/v1/organizations/*`: invitations, memberships, roles, owner changes,
  effective permissions and scoped audits (server-enforced authorization).

## Appearance

Open the bottom account menu, choose **Account settings**, then **Appearance**.
Choose **Light**, **Dark** or **Follow system**, select the teal, blue or violet
accent, then **Save appearance**. Preferences are saved to your user account
across organizations and devices. Saving keeps an open invoice draft intact.
The sign-in page follows the device's system theme; signing out clears the
previous user's appearance from the page. Printed invoices keep their paper layout.
Existing installations must apply migration `0006_user_appearance.sql` with
`pnpm db:migrate` before starting the updated API.

## Checks and migrations

Phase 6 commercial hardening is in progress. Host-only commands and exact release
boundaries: [encrypted backup/restore](docs/backup-recovery.md),
[signed entitlements](docs/licensing-operations.md), and
[signed release preflight](docs/signed-releases.md). Production business writes
require verified entitlements; development remains unlicensed unless configured.
Official invoice issuance is still independently gated. This is not yet a signed
commercial installer or a deployed SaaS service.

For direct HTTPS, see [certificate validity, expiry logs and renewal](docs/https-operations.md).

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm db:generate
pnpm db:migrate
```

`db:generate` should report no changes on this checkout. Review generated SQL
before committing; never use schema push or migrations on server startup.
`pnpm smoke` starts a temporary loopback compiled API, checks served frontend assets,
real DB readiness, OpenAPI and Origin rejection, then stops it. Run after migration
and build; it requires the local `.env`. This checks HTTP connectivity, not browser
rendering or a trusted LAN TLS installation.
For an optional browser render check, set `BROWSER_PATH` to a local Chrome/Edge
executable before `pnpm smoke`. It runs headlessly with a separate ignored profile
and asserts the rendered Connected/Ready indicators. It preserves browser sandboxing
and certificate validation. This still does not validate LAN TLS trust.
`pnpm format` applies formatting. Build compiles shared packages before apps.
`pnpm start` starts the compiled API; set `WEB_ROOT` to the absolute
`apps/web/dist` directory to serve the built frontend from the same API origin.
For example, in PowerShell after build:

```powershell
$env:WEB_ROOT = (Resolve-Path apps/web/dist).Path
$env:APP_ORIGIN = 'http://localhost:3000'
pnpm start
```

Open http://localhost:3000 for this loopback-only compiled smoke test.
Production/LAN requires TLS key/cert paths, HTTPS APP_ORIGIN, exact ALLOWED_HOSTS
authorities (including port), and an explicitly chosen HOST. The API never trusts
forwarded Host/Origin or enables wildcard CORS. Complete the documented
deployment/security validation before production use; enabling ordinary invoices
does not complete the separate deployment release requirements.

Integration and browser tests use separate random databases and deliberately fail
when no admin URL is supplied. With the development container running, PowerShell:

```powershell
# Read the generated local values without printing credentials.
$env:TEST_DATABASE_ADMIN_URL = node --env-file=.env -e "process.stdout.write(process.env.MIGRATION_DATABASE_URL)"
pnpm test:integration
# After pnpm build, verify actual browser workflows:
$env:BROWSER_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
pnpm test:e2e
Remove-Item Env:TEST_DATABASE_ADMIN_URL
```

On POSIX:

```sh
export TEST_DATABASE_ADMIN_URL="$(node --env-file=.env -e 'process.stdout.write(process.env.MIGRATION_DATABASE_URL)')"
pnpm test:integration
unset TEST_DATABASE_ADMIN_URL
```

Playwright uses installed Chrome/Edge via BROWSER_PATH, or install its Chromium
once with `pnpm exec playwright install chromium`. Browser tests provision only
temporary isolated accounts, verify login/MFA/admin flows and remove their DB.
No default dev user is silently created. Traces/videos/screenshots are disabled
to avoid storing credential-bearing screens.

Only use a disposable local/CI cluster with CREATEDB privilege. Tests migrate a
new `gst_test_<uuid>` database twice, check constraints/transaction rollback and
drop that test database in cleanup. CI runs these checks with PostgreSQL 18.6;
remote workflow execution is separate from locally observed results.

## Boundaries and deployment spike

`apps/api` owns transport/operations, `apps/web` the React shell,
`packages/database` schema/migrations/pool, `packages/contracts` runtime transport
validation, and `packages/billing-engine` the versioned exact GST preview engine.
Identity/admin, master data and the invoice workspace are implemented. Invoices have
transactional finalization infrastructure, immutable history, value corrections,
cancellation and A4 printing. Ordinary invoices can be finalized within the
released scope; e-invoicing and issued corrections/cancellation remain gated.

Read [architecture](docs/architecture.md), [requirements](docs/requirements.md),
[decisions](docs/decisions.md), [execution plan](docs/development-plan.md), and
[review evidence](docs/review-coverage.md).
See [Phase 2 scope](docs/phase-2.md) and
[identity operations](docs/identity-operations.md) for provisioning/recovery,
delegation, session defaults and deployment limitations.
See [Phase 3 scope and setup](docs/phase-3.md) for business setup, catalog review,
upgrade permissions and the boundaries of local GST validation.
See [Phase 4 policy/source review](docs/phase-4.md) and the
[engine example](packages/billing-engine/README.md) for supported arithmetic,
discount bases, rounding and the recorded ordinary-invoice release scope.

[Windows spike runbook](docs/windows-offline-spike.md) provides executable PoC
scripts for a dedicated PostgreSQL instance, checksum-verified Windows API service,
private-CA TLS and scoped firewall. Actual elevated service install, CA trust,
LAN browsers and recovery require a disposable Windows VM. Parser checks are
not deployment proof; the runbook labels each unverified item.

For publisher assembly of the actual operator-run installation directory, see
[Windows bundle preparation](docs/windows-bundle.md). An unsigned candidate is
separate from vendor approval, production signing and native Windows acceptance.

## Invoice workspace (Phase 5)

Saved records have their own URLs: `#/invoices/:id`, `#/customers/:id` and
`#/catalog/:id`. Refreshing a detail page reopens that record; use **All invoices**
or **Back to list** to return. New records use `/new` within each section.
Customer and catalog forms are pages; invoice customer/item selectors remain dialogs.
Unsaved edits prompt before leaving and are not saved by refreshing.

After updating dependencies, run `pnpm db:migrate` and restart `pnpm dev`. Sign in
as the owner and open **Invoices → New invoice**. Choose a customer, add catalog
items, enter quantities/discounts, confirm the supported supply facts and choose
**Calculate & preview** or **Save draft**. Catalog tax classifications must be
reviewed and business GST registration confirmed. **Print draft** opens browser
printing with a prominent draft warning. Bank details come from Business setup;
notes and terms belong to the draft.

Owners receive the new permissions through their existing owner authority.
Existing non-owner roles retain their grants: explicitly grant invoice permissions
and customer/catalog read access as needed. Invoice access is MFA-sensitive on SaaS.
The owner confirmed CA approval on 2026-11-05. For supported ordinary domestic
invoices, save the draft, calculate a fresh preview, then **Finalize invoice**.
Business setup must be complete and e-invoice applicability must be assessed as
**Not required**; **Unknown** and **Required** remain blocked while IRP integration
is on hold. Do not change applicability merely to unlock finalization.
Partial/full value credits and debit notes use original invoice tax details;
correction drafts can be edited, but issuing credit/debit notes remains outside
this release. Drafts can be discarded with a
recorded reason. Issued cancellation remains compliance-gated and never reuses a
number. Grant `invoices.cancel` separately; existing non-owner grants are unchanged.
Upload a PNG logo in Business setup; new documents snapshot it for historical printing.
See [Phase 5](docs/phase-5.md) for exact supported correction and cancellation boundaries.

## Troubleshooting

- Docker pipe/daemon missing: start Docker Desktop with Linux containers, or use
  dedicated PostgreSQL and edit the URLs. The CLI alone cannot host PostgreSQL.
- Readiness 503: verify DB startup, credentials, explicit migration completion and
  runtime SELECT privilege. Liveness remains available during database failure.
- HTTP 403: use the documented hostname/port; ALLOWED_HOSTS is exact and includes
  ports. Browser Origin must equal APP_ORIGIN. Do not disable checks for LAN.
- Startup failure: check configuration field values, TLS file permissions and port
  conflicts. Logs deliberately omit raw driver errors and connection strings.
- Changed Docker password in `.env`: existing volumes retain their original
  database password; deliberately rotate with PostgreSQL rather than deleting data.
- Shared package import failure: run `pnpm build:packages` before invoking an app
  directly. Root dev/test/typecheck/build commands do this automatically.
- Locked migration: inspect other migration processes; invocations have bounded
  connection/query/lock waits. Never delete migration history to force a rerun.
