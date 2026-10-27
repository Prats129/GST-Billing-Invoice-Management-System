# Review coverage

## Batch 1 — audit and architecture (2026-10-27)

- Read PROJECT_CONTEXT.md and PHASE_1_CODEX_PROMPT.md completely; repository had
  license, placeholder README, empty .gitignore and untracked planning documents.
  Preserved original planning files. No existing application code or tests.
- Created architecture, requirements, decisions and development plan.
- Commands: git status --short; node/npm/pnpm versions; docker info; psql lookup;
  npm metadata queries. Node 22.13.0, npm 11.15.0, pnpm 9.15.4 present.
- Docker CLI 29.9.2 present but daemon pipe absent; PostgreSQL binaries not on PATH.
- Sandbox npm network initially refused proxy connection; approved escalation to
  registry succeeds. Official Node/Nest/Vite/PostgreSQL references consulted.
- Next: implement workspace/API/web/database, install dependencies and execute checks.
- Pending: actual DB runtime and privileged Windows service/LAN/trust verification.

## Batch 2 — foundation implementation

- Added pnpm workspace, strict TS/ESLint/Prettier/Vitest tooling, ESM Nest API,
  versioned liveness/readiness, OpenAPI JSON, safe errors/logs, exact Host/Origin
  checks, TLS boundary, bounded DB pool and React connectivity shell.
- Shared runtime contracts and unimplemented billing-engine version boundary.
- Added Drizzle organizations schema, explicit serialized migration runner,
  isolated random-database integration tests and loopback-only Docker Compose.
- Added API/config and frontend request tests. Verification pending dependency install;
  implementation is not yet claimed to pass.
- Next: install/pin dependency lockfile, generate and review first migration,
  run checks, add CI/README and execute runtime smoke tests.

## Batch 3 — Windows spike and CI

- Added seven PowerShell PoC scripts and Windows runbook for isolated PostgreSQL,
  checksum-verified WinSW, restricted service identity, private CA/leaf generation,
  explicit trust and private-subnet firewall. Teardown preserves data.
- `powershell -NoProfile -File apps/windows-installer/scripts/Test-SpikeScripts.ps1`:
  seven scripts parse. Checksum helper accepts matching/rejects mismatching hash.
- ACL runtime probe blocked by sandbox Set-Acl UnauthorizedAccessException; no
  privileged installation attempted. PostgreSQL/service/LAN/HTTPS trust/reboot
  remain UNVERIFIED. See windows-offline-spike.md for the VM acceptance matrix.
- Added Linux build/test/database CI and Windows script-syntax job. CI itself has
  not been run remotely. Next: resolve install, migration generation and checks.

## Batch 4 — install and first verification

- Installed workspace using pnpm 10.34.9 and generated reproducible resolution lockfile.
  Replaced unsupported ESLint 9 with compatible ESLint 10; TS6 explicitly pinned
  because current Nest and typescript-eslint support it (not TS7).
- Generated and reviewed organizations migration and Drizzle journal/snapshot.
  `db:generate` initially hit sandbox spawn EPERM; approved compiler execution works.
- Fixed Windows cmd quoting in workspace scripts after an initial command silently
  matched no package globs. Explicit package-name filters now compile all packages.
- Initial build caught missing CSS import declaration; added Vite client types.
- Downloaded temporary ignored PostgreSQL 18.4 binaries for local tests, not product
  dependencies/artifacts. initdb completed (exit 0); actual startup/tests pending.
  Target packaged/development version remains patched PostgreSQL 18.6.
- Added secure random local .env setup and README/CI commands. Remaining: complete
  lint/typecheck/unit/build, DB integration and actual HTTP/proxy smoke verification.

## Batch 5 — real database and failure fixes

- Isolated PostgreSQL 18.4 started on 127.0.0.1:55432 after sandbox restricted-token
  startup failed; no system service/existing cluster changed.
- `pnpm test:integration`: PASS, 1 file / 3 tests; fresh randomized database,
  migration applied twice, insert, invalid-state/blank-name constraints and rollback;
  test database dropped during cleanup.
- Strict typecheck and build of API/web/packages PASS after fixing CSS types and
  using Swagger's JSON-only setup API with Nest 12 type definitions.
- Initial unit suite: 15/16 passed; shutdown assertion caught the DB cleanup override
  not running. Replaced override with Nest onApplicationShutdown lifecycle provider;
  rerun pending. No claim of passing shutdown before this verification.
- Added compiled HTTP smoke command; final formatting/lint/frozen install and runtime
  checks remain pending. Remote CI, Docker target 18.6 and browser/LAN tests unverified.

## Batch 6 — successful application verification

- `pnpm typecheck`: PASS including strict checking of tests/configuration.
- `pnpm build`: PASS; all shared packages, Nest API, Vite client assets compiled.
- `pnpm test`: PASS, 3 files / 16 tests, including shutdown lifecycle fix.
- `pnpm lint`: PASS; `pnpm install --frozen-lockfile --offline`: PASS (lockfile
  unchanged; pnpm noted intentionally blocked optional Scarf telemetry install script).
- `ENV_FILE=<private test env> pnpm db:migrate`: PASS against isolated cluster;
  second `pnpm db:generate`: no schema changes.
- `node --env-file=.local/test-db.env scripts/smoke.mjs`: PASS compiled static
  assets, API health, real migrated DB readiness, OpenAPI, forbidden Origin.
- With BROWSER_PATH set to installed Edge, then Chrome: PASS twice; both actual
  headless browsers rendered API Connected and PostgreSQL Ready without disabling
  browser sandbox or certificate verification. This was loopback HTTP only.
- PowerShell parser rerun PASS (7 files). Get-NetTCPConnection read probe blocked
  by sandbox permissions; SQL/OS listener evidence and cleanup remain final checks.
- Preserved concurrent user additions ignoring the two root handoff documents.
- Next: final config regression test/build, format check, development proxy smoke,
  stop temporary database and record exact remaining deployment limitations.

## Batch 7 — cleanup checkpoint (2026-10-27)

- Final `pnpm typecheck`, `pnpm test` (17/17), `pnpm build` and
  `pnpm format:check`: PASS. `pnpm lint`: PASS after final source formatting.
- Development entry points verified with native TypeScript Nest startup and Vite
  same-origin proxy: `/api/v1/health/ready` returned ready through port 5173;
  frontend HTML served successfully. Temporary API/web processes stopped.
- Headless Chrome and Edge both rendered Connected/Ready using built frontend.
- OS listener check (approved read outside sandbox) showed only 127.0.0.1:55432;
  no development API/web listener remained after cleanup. `pg_ctl ... -m fast -w stop`:
  PASS. Temporary PostgreSQL data retained, server stopped, no Windows
  service installed. `node scripts/setup-env.mjs` rerun preserved existing .env.
- `git diff --check`: PASS (Git notes repository CRLF conversion policy).
- Final CI uses current official checkout/setup-node/pnpm action majors, restricted
  contents:read permissions, isolated service credentials and compiled HTTP smoke.
  Workflow has not executed remotely.

### Execution environment notes

Initial verification used system Node22 and temporary PostgreSQL18.4. Batch8 below
supersedes those environment limitations with Node24/PostgreSQL18.6 verification.
Temporary tool binaries are ignored and not distributed. Early checks used
`npm exec --offline --cache .cache/npm --package=pnpm@10.34.9 -- pnpm <command>`
because global pnpm is 9.15.4. Initial
registry installs used the same wrapper with `--offline=false` under approved
network escalation. Compiler/process checks required approved execution outside
the sandbox after spawn EPERM/restricted-token failures.

The Windows spike meets Phase 1's executable-PoC boundary. Installer-managed DB
service, actual WinSW identity/reboot lifecycle, private-CA trust, LAN/firewall
behavior, certificate renewal, signed installer and recovery remain UNVERIFIED
or later-phase release gates. No production/customer billing claim is made.

Next work: run CI on Node24/PostgreSQL18.6; execute the disposable Windows VM spike
matrix; then Phase 2 secure identities/sessions, tenant memberships/RBAC, delegated
privileges and concurrency-tested owner protection before business endpoints.

## Batch 8 — recommended runtime and documented database target

- Downloaded ignored Node 24.22.1 executable without changing system Node. PATH
  scoped to verification process selects Node 24.22.1 and pnpm 10.34.9.
- Node24: lint, strict typecheck, unit tests (17/17), integration tests (3/3 against
  native18.4), API/web build and format check PASS. Edge render smoke PASS; native
  PostgreSQL shutdown PASS. System Node/pnpm installations were preserved.
- Started existing Docker Desktop hidden; daemon became available. `docker compose
up -d --wait`: PASS, new development cluster healthy. PostgreSQL reports
  `18.6 (Debian 18.6-1.pgdg13+2)`; published address verified `127.0.0.1:5432`.
  This resolves the earlier Docker unavailability; no existing cluster changed.
- On Node24 + Docker18.6: `pnpm db:migrate` PASS; `pnpm test:integration` PASS
  (3/3); `BROWSER_PATH=<Chrome> pnpm smoke` PASS including rendered Connected/Ready;
  `pnpm install --frozen-lockfile --offline` PASS, no lockfile changes.

## Phase 1 final acceptance

Implemented all Phase 1 application/tooling deliverables. Verified on Windows with
Node24.22.1, pnpm10.34.9 and PostgreSQL18.6: install, lint, strict types, 17 unit
tests, 3 isolated DB tests, clean/repeated migration, no schema-generation drift,
build, HTTP smoke and rendered browser connectivity. Development TypeScript/Vite
proxy path also passed. Secure defaults include loopback-only PostgreSQL, exact
Host/Origin checks, TLS required for LAN, sanitized errors/logs and ignored secrets.

Current local state: Docker development PostgreSQL18.6 is healthy on
127.0.0.1:5432 with reviewed migration applied and data preserved in its named
volume. Root ignored .env is configured for it. API/web smoke processes and the
temporary native18.4 cluster are stopped. Use README startup commands; `pnpm
db:down` stops Docker development services without deleting data.

Unverified: remote GitHub CI execution; privileged Windows service/installer
lifecycle, LAN HTTPS/private-CA trust, firewall/client matrix and reboot/recovery.
The executable spike and explicit VM runbook satisfy Phase 1's prototype boundary;
they are not a production installer. Phase 2 priorities remain secure identities,
opaque sessions, tenant memberships/RBAC, delegated authority and protected-owner
invariants. No GST compliance or customer billing readiness is claimed.

## Batch 9 — crash recovery audit (2026-10-27)

- Resumed from the existing Phase 1 acceptance checkpoint; did not regenerate or
  replace application source, lockfile, migrations, environment or Windows scripts.
- `git diff --name-status` and `git ls-files --deleted`: empty. Existing Phase 1
  files are staged and match their working copies; staging is preserved.
- `git diff --cached --check`: PASS. Source/package files, generated migration
  metadata, dependencies, private .env and temporary Node24/pnpm10 tools survived.
- Saved an ignored staged patch and SHA-256 content baseline under .local before
  editing this progress log. Environment values were not printed.
- Docker daemon is stopped following the crash (missing Linux-engine pipe).
  Previous passing results remain historical evidence, not new verification.
- Next: restart existing Docker, check the retained database, perform a frozen
  install and rerun lint/types/tests/build/migration/browser smoke. Preserve all
  existing source changes, secrets, migration history and database volumes.

## Batch 10 — preserved development environment recovered

- Restarted existing Docker Desktop and ran `docker compose up -d --wait`: PASS.
  Existing container recovered healthy; existing volume and credentials retained.
- PostgreSQL reports 18.6 and retains one entry in drizzle.__drizzle_migrations.
  Published endpoint remains 127.0.0.1:5432, with no LAN database exposure.
- Node24.22.1/pnpm10.34.9 tools recovered; frozen offline install PASS and lint PASS.
  Strict types/unit/build checks are still running at this checkpoint.
- SHA-256 baseline comparison: only this recovery log changed. All application
  source, lockfile, migrations and .env remain byte-identical to recovery start.
- Next: complete running checks, rerun isolated DB tests/migration/actual browser
  smoke, check staging and record final recovery results. No Phase 2 work added.

## Batch 11 — post-crash foundation checks

- Using recovered Node24.22.1/pnpm10.34.9: frozen offline install, lint, strict
  typecheck, unit tests (17/17), API/web/package build and format check all PASS.
- PowerShell script parser: PASS for all seven files; no privileged host changes.
- `pnpm db:migrate`: PASS against retained PostgreSQL18.6 database; existing
  migration safely recognized. `pnpm exec vitest run --project integration`: PASS
  (3/3), using already-rebuilt packages. Random test database cleaned up normally.
- No source fixes or dependency/schema replacements were needed. Remaining final
  recovery checks: schema generation drift, rendered Chrome/Edge connectivity,
  development proxy and final file/staging preservation comparison.

## Batch 12 — crash recovery completed

- `pnpm db:generate`: PASS, no schema changes or new migration files.
- `BROWSER_PATH=<Edge> pnpm smoke` and `BROWSER_PATH=<Chrome> pnpm smoke`: PASS;
  both browsers rendered Connected/Ready against the recovered PostgreSQL18.6.
- Native TypeScript API/Vite development proxy smoke: PASS. No application source
  replacement or further Phase 1 implementation was necessary after recovery.
- Final SHA-256 comparisons: zero unexpected tracked source changes; .env is
  unchanged. Saved staged-patch comparison confirms the entire original staging
  area is unchanged. Only this progress log was updated in the working tree.
- Git working-tree and staged whitespace checks PASS. Docker database remains
  healthy on 127.0.0.1:5432, migration history retains one entry, and integration
  tests left zero gst_test_* databases. Existing development data was preserved.
- All Phase 1 local acceptance checks have now passed again after the laptop crash.
  Remote CI execution and privileged Windows service/LAN HTTPS/firewall/reboot
  validation remain UNVERIFIED as before; see windows-offline-spike.md.
- No Phase 2 features, resets, staging replacements, credential regeneration,
  volume deletion or changes to historical migration files were performed.
