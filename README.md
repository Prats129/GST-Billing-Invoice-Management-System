# GST billing platform

Shared Windows offline and SaaS billing platform under development. Phase 1 provides
the technical foundation; Phase 2 adds login, sessions, MFA, organization memberships
and permission-based administration. Phase 3 adds business/GST setup, customers
and a product/service catalog with classification review. Phase 4 adds a pure,
decimal-safe GST calculation preview library. Invoice creation/issuance remains
unimplemented; no legal-compliance or production-readiness claim is made.

## Prerequisites

- A currently patched Node 24 LTS (`.nvmrc`: 24.22.1) and pnpm 10.34.9.
  `npm install --global pnpm@10.34.9` if pnpm is unavailable.
- Docker Desktop/Engine running with Linux containers for PostgreSQL 18.6,
  or your own dedicated local PostgreSQL 18 instance. PostgreSQL must bind only
  to loopback; never expose its port to LAN clients.
- Windows PowerShell 5.1+ for the optional deployment spike.

Version choices: NestJS 12 (provisional Express), Vite 8/React 19, TypeScript 6,
Drizzle ORM 0.45 and PostgreSQL 18. Exact dependency resolutions are locked in
pnpm-lock.yaml. Node 22.12+ is compatible, but use a current security patch;
the preinstalled 22.13.0 host runtime is not the recommended deployment runtime.
See [runtime support](https://nodejs.org/en/about/previous-releases),
[Nest requirements](https://docs.nestjs.com/migration-guide),
[Vite requirements](https://vite.dev/guide/) and
[PostgreSQL support](https://www.postgresql.org/support/versioning/).

## Local startup

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

## Checks and migrations

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
forwarded Host/Origin or enables wildcard CORS. Customer billing remains deferred;
complete the documented deployment/security validation before production use.

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
Identity/admin and business/customer/catalog screens are implemented; the invoice
builder, transactional issuance, corrections and printing remain deferred.

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
discount bases, rounding and remaining professional approval gates.

[Windows spike runbook](docs/windows-offline-spike.md) provides executable PoC
scripts for a dedicated PostgreSQL instance, checksum-verified Windows API service,
private-CA TLS and scoped firewall. Actual elevated service install, CA trust,
LAN browsers and recovery require a disposable Windows VM. Parser checks are
not deployment proof; the runbook labels each unverified item.

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
