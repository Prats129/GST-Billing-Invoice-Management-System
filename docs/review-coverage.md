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

## Phase 2 / batch 1 — scope and threat boundary

- User authorized Phase 2 implementation. Re-read the full project context and
  current code/schema/configuration. Working tree clean; Phase 1 is committed.
- Defined acceptance and reversible choices in phase-2.md. Consulted official
  OWASP and dependency documentation for password/session/CSRF/TOTP behavior.
- Existing health API, migrations and Windows spike will be preserved; additive
  security modules/schema follow, with tenant/privilege/concurrency tests.
- Next: identity/authorization schema, reviewed migration and security primitives.
- Untested at this checkpoint: all new Phase 2 functionality.

## Phase 2 / batch 2 — schema, services and executable security tests

- Added identities, edition-separated memberships/sessions, tenant-scoped roles,
  permission/delegation grants, hashed sessions/recovery credentials, encrypted
  MFA secrets, persistent throttles and audit events. Existing migration0000 intact.
- Generated additive migrations0001/0002. Review caught Drizzle emitting composite
  FKs before their referenced unique constraints; reordered the new unapplied SQL.
  Added serialized owner/edition integrity and append-only audit triggers.
- Added session/CSRF/password/TOTP/recovery services and REST controllers. Global
  shared-user password resets are forbidden across tenant boundaries.
- Installed Argon2id/OTPAuth; first install needed a non-interactive dependency-link
  refresh. Fixed query typing; compiler caught inferred-export type annotations.
- Added isolated HTTP/DB security tests (tenant attacks, delegation, concurrency,
  session expiration/revocation, MFA replay/recovery and audit immutability) and
  cryptographic behavior tests. Not yet run at this checkpoint.
- Next: execute tests/migrations, fix failures, implement identity/admin UI and host
  provisioning/recovery runbook. Phase 2 is not yet complete.

## Phase 2 / batch 3 — first execution and browser-facing flows

- Strict TypeScript passed for security services/controllers. First isolated DB/HTTP
  run PASS (12 tests total), including tenant constraints, ownership concurrency,
  session revocation/expiry, TOTP replay, single-use recovery and audit protection.
- Added acceptance-based invitations for existing identities, MFA rotation/disable
  rules, mandatory SaaS gating and host recovery credentials persisted before commit.
- Added React login, forced password change, MFA enrollment/challenge, organization
  switching, member/role/delegation administration, audit and session management.
  Paginated role editing retains unseen assignments rather than silently removing them.
- Added Playwright end-to-end tests using disposable databases and actual browser
  accounts. Dependency install/types/browser execution pending at this checkpoint.
- Next: run expanded tests, UI/browser verification and migration upgrade; finish
  operator/setup documentation and resolve any failures. Phase 2 remains in progress.

## Phase 2 / batch 4 — completed scope and regression checkpoint

- Added consent persistence preventing invite→suspend→activate bypass, safe member
  removal, effective-permission views, bounded password work/throttle cleanup and
  employee-reset/shared-account protections.
- Consolidated only the new, untracked/unapplied migration drafts into reviewed
  0001_identity_authorization.sql with final snapshot. Saved drafts under ignored
  .local for recovery; Phase 1 SQL/snapshot are untouched. New migration still
  requires fresh/upgrade execution after consolidation.
- Split React identity/admin forms into focused member, role and account-security
  components. Added private host CLI provisioning/recovery test and operator guide.
- First full lint run caught cleanup throwing inside finally in the new CLI test;
  fixed it to preserve original failures. Expanded full check/browser run underway.
- CI now includes the actual browser workflows on disposable databases. Remote
  workflow execution remains unverified. Next: fix any runtime/browser failures,
  verify upgrade and finish final evidence. Phase 2 is not yet marked complete.

## Phase 2 / batch 5 — regression fixes and unit verification

- Lint and strict types PASS after fixing the CLI's exact-optional-field typing.
  OpenAPI bodies now derive from the shared runtime contracts; login is explicitly
  documented without a pre-existing authentication requirement.
- Unit tests PASS (20/20). Initial Argon2 assertion assumed PHC parameter order;
  corrected it to assert algorithm/version and exact costs independently of order.
- Added MFA mandatory-disable/recovery-code-rotation assertions and full host CLI
  tests; expanded isolated integration/browser run is now executing.
- React member/role/account-security components are separate, preserve paginated
  assignments and display effective permissions. Operator guide documents no default
  login, existing-user consent, protected recovery and limited runtime DB privileges.
- Next: complete runtime/browser run, fix failures, apply reviewed upgrade locally,
  verify migration drift and update final acceptance evidence.

## Phase 2 / batch 6 — resumed verification (2026-10-28)

- Resumed the existing uncommitted Phase 2 changes after the session limit. No
  reset, dependency/schema recreation or change to Phase 1 history.
- Previous run completed 20 unit tests and 18 DB/HTTP integration tests. Browser
  run failed waiting for the organization selector after login; second scenario
  did not run. Those browser flows were not claimed as passing.
- Corrected select labels to explicitly reference their controls rather than
  include option text in the label. Added an explicit browser login-response
  assertion so an authentication failure is distinguished from selector failure.
- Next: run browser workflows, resolve failures, verify the additive local upgrade,
  finish regression checks and record final Phase 2 status. No new feature scope.

## Phase 2 / batch 7 — resumed browser verification and upgrade preparation

- Rebuilt the existing implementation; both Chrome Playwright workflows now PASS
  (2/2): owner role/member administration, employee forced password change,
  suspension revocation, authenticator enrollment and recovery-code login.
- One intermediate run hit the test server's cold-start deadline. Added a bounded
  startup allowance and sanitized startup-event/status diagnostics; no raw server
  stderr or credential payloads are echoed. Browser authentication now has an
  explicit status assertion instead of timing out on a later control.
- Verified Phase 1 SQL/snapshot have no changes. Development DB still has one
  migration and zero organizations. Created/inspected a pg_dump custom archive in
  ignored .local/backups before applying the pending upgrade. This was archive
  inspection, not a restore rehearsal.
- Windows spike guide now points to Phase 2 runtime privileges instead of implying
  the original organization-only grants are sufficient for the current checkout.
- Next: apply/repeat the upgrade, verify drift/credentials, run final regression
  and Edge workflows, then update acceptance and remaining deployment limitations.

## Phase 2 / batch 8 — local upgrade and setup-command correction

- setup:env added only the missing MFA encryption key; hashed comparisons confirm
  existing DB credentials/settings were preserved. Applied the reviewed upgrade
  twice successfully; db:generate reports no schema changes. Frozen offline install
  PASS without lockfile changes. Final regression run continues.
- Reviewed the documented first-owner command and found its filtered package
  invocation changed working directory, breaking root-relative private file paths.
  Kept the root CLI entry in the root directory and extended the existing isolated
  CLI test to run that exact pnpm command with relative paths. This fixes the setup
  workflow; it introduces no new feature or credential defaults.
- Next: finish regression/Edge verification, confirm no temporary test DB/processes
  remain, and record final acceptance/operational limitations.

## Phase 2 / batch 9 — complete browser run and final consent-boundary fix

- Final regression run PASS: 20 unit tests, 18 isolated integration tests, Edge
  browser workflows (2/2) and compiled HTTP/browser health smoke. Chrome workflows
  also passed (2/2) in batch7. New root-relative host CLI regression passed.
- Format check caught the newly edited CLI test's formatting; corrected it and
  lint passed. No dependency or product feature scope added.
- Final review found pending invitations were included in password-reset authority:
  an invite could block the real tenant's reset, or authorize a reset of an orphan
  identity without consent. Restricted reset authority/shared-account checks to
  accepted memberships and extended the existing consent regression for both cases.
- Next: verify this focused security correction, rerun required checks, confirm
  preserved migration history and clean test-resource teardown, then final acceptance.

## Phase 2 / batch 10 — final local acceptance (2026-10-28)

- Consent/reset correction verified: 18/18 isolated integration tests PASS, including
  the actual root pnpm provisioning command with relative private input paths.
  New regressions prove unaccepted invitations neither grant password-reset
  authority over an orphan identity nor block the actual tenant's authorized reset.
- Lint/strict typecheck PASS; API rebuilt. Chrome workflows PASS (2/2) after that
  correction, with compiled HTTP/browser health smoke PASS. Edge workflows also
  PASS (2/2) in the final regression run. Unit suite PASS (20/20).
- Frozen offline install PASS, reviewed migration applied/repeated successfully,
  schema generation reports no drift. Formatting checks PASS after formatting
  the latest regression test. Root DB credentials preserved; missing MFA key added
  without replacing existing values.
- Development PostgreSQL18.6 remains healthy at 127.0.0.1:5432; migration count=2,
  organization/user counts=0, leftover gst_test_* databases=0. No temporary API/Vite
  listeners remain. Existing customer/development records were not replaced; no
  default owner account was created. First owner is an explicit operator setup.
- Original Phase 1 SQL/snapshot have no differences from HEAD. Retained the inspected
  pre-upgrade custom archive under ignored .local/backups (not a restore rehearsal).
  Existing Git staging was preserved; final fixes are in the working tree for review
  and must be staged before committing the completed changes.
- Final post-fix unit run PASS (20/20); formatting and working-tree/staged Git
  whitespace checks PASS. Repeating setup:env preserved the entire configured .env
  byte-for-byte, including the existing MFA key.

Phase 2 implementation/local acceptance is complete. Remaining release gates:
remote GitHub CI execution; real Windows service/ACL/LAN HTTPS/firewall/reboot tests;
reviewed SaaS all-factors-lost platform recovery. These are not claimed as verified.
No catalog, GST math, invoicing, licensing, payments or other later-phase features
were added. Next implementation phase is business/GST registration, customers and
catalog, after review/commit of this phase.

## Local owner setup assistance (2026-10-28)

- User requested completion of setup using their existing private provisioning file.
  Validated field/JSON correctness without printing credentials. Confirmed no
  matching account/organization existed, avoiding duplicate provisioning.
- Existing database healthy; environment preserved and migrations current. Created
  the requested owner via the documented root command. Recovery output is in an
  NTFS-restricted .local/identity directory; input file permissions restricted too.
- Existing frontend was running but its API proxy returned502 because backend was
  absent. Started only the backend development watcher; preserved the user's frontend.
- Actual browser login, owner organization, member/role screens and logout PASS.
  Verification session was signed out; app processes remain running for the user.
- Found Vite's workspace file serving allowed a HEAD request to the private setup
  file. Added .local to fs.deny while retaining the default secret/Git exclusions.
  Verified403 for setup/recovery files, .env and .git/config; browser login still PASS.
- No passwords, recovery credentials or session tokens printed to chat/logs. No
  existing credential file, recovery output or database volume was overwritten.

## UI redesign / batch 1 — review and layout direction (2026-10-28)

- User requested a substantial UI correction. Reviewed the existing React panels,
  session/authorization flows, CSS, browser tests and smoke checks before editing.
- Identified the main problems: narrow stacked layout, always-visible forms,
  technical permission labels, weak hierarchy and developer diagnostics in the
  main workflow.
- Implementing separate overview/member/role/security/activity views, responsive
  navigation, readable tables/cards and accessible dialogs. Scope is presentation
  and interaction; existing authentication/API/tenant rules remain authoritative.
- Next: implement the visual foundation and screens, update browser tests for
  explicit navigation/dialogs, then verify desktop/mobile appearance and workflows.

## UI redesign / batch 2 — implementation (2026-10-28)

- Replaced the long stacked page with a responsive sidebar workspace, separate
  overview, members, roles, activity, account-security and system-status views.
- Added a team table with page-local search, role cards, readable permission
  groups, focused native dialogs, keyboard dismissal/focus restoration, and a
  dedicated sign-in layout. No external fonts, assets or dependencies added.
- Preserved existing API contracts, tenant permissions, owner protections,
  password/MFA/recovery and session operations. Role sharing remains a subset
  of selected permissions; server authorization remains authoritative.
- Frontend TypeScript check passed. Browser workflows updated for navigation,
  dialogs and responsive overflow checks; build/lint/browser verification underway.
- Existing staged changes and local credentials were preserved.

## UI redesign / batch 3 — regression fixes and verification (2026-10-28)

- Production build, lint, 20 unit tests and full workspace/test TypeScript checks
  passed. Desktop overview/role/member screenshots inspected using test-only data.
- Browser checks found that reselecting the already-selected organization could
  clear its context without fetching again. Added an equality guard and retained
  the regression scenario in the browser workflow.
- Mobile overflow/search-layout checks caught presentation issues. Replaced the
  phone member table with compact member cards and fixed search-field direction.
- Keyboard dialog opening, initial focus, Escape dismissal/focus return, role
  creation and member creation passed before the responsive assertion. Full
  workflows are being rerun after those fixes.
- API/static smoke checks passed. The optional Chrome command-line DOM smoke
  process exited with no output; this is not a passed browser smoke check.
- Edge's headless DOM smoke passed: built sign-in screen and healthy service
  status rendered against the migrated development database. No business rows
  were changed by that smoke check.
- Phone member cards, mobile navigation, overflow checks, forced password change,
  employee access restrictions and HttpOnly cookie checks passed in Chrome.
  Membership status labeling was made explicit before rerunning the complete flow.

## UI redesign / batch 4 — final local acceptance (2026-10-28)

- Both complete browser workflows passed in Chrome (2/2) and Edge (2/2), using
  disposable databases. Verified role/member creation, membership suspension,
  forced password change, employee authorization, HttpOnly cookies, authenticator
  enrollment, recovery-code display/use and MFA sign-in.
- Also verified desktop/390px phone overflow, mobile navigation, separate screens,
  and dialog initial focus/Escape/focus restoration. Inspected screenshots of
  desktop overview/roles/members and phone members; captures use fixture data only.
- Production build, full TypeScript, lint, formatting and 20 unit tests passed.
  Edge browser startup smoke passed, including live API/database connectivity.
  The earlier optional Chrome CLI DOM launch failure remains recorded above;
  Chrome Playwright workflows passed after the fixes.
- UI changes add no dependencies or backend/schema changes. Existing credentials,
  business data and staging were preserved. Automated checks provide local
  regression evidence, not a performance benchmark or an exhaustive audit.
- Phase 2 implementation/local acceptance remains complete with the redesigned
  UI. Native Windows service/LAN HTTPS/firewall/reboot and remote CI release gates
  described in phase-2.md remain outstanding; loopback browser tests do not prove them.

## Phase 3 / batch 1 — requirements and architecture review (2026-10-28)

- Read PROJECT_CONTEXT.md completely and reviewed current schema, identity/RBAC,
  controllers, API error handling, workspace UI, tests, migrations and CI.
- Working tree was clean after the Phase 2 commit. No credentials were read/output.
- Defined Phase 3 scope/acceptance in phase-3.md and checked official GST taxpayer,
  HSN and NIC state references. No statutory rates or invoice compliance invented.
- Next: shared contracts, tenant business schema and reviewed migration; then API,
  responsive screens and isolated integration/browser verification.

## Phase 3 / batch 2 — contracts, schema and API implementation

- Added shared strict validation for domestic addresses, structural GSTIN/state,
  customer/catalog inputs, decimal-string prices/rates, units and versioned writes.
- Added business profiles, one-active GST registration/history, customers, catalog,
  immutable dated tax revisions and review attestations with tenant-safe FKs.
- Generated/reviewed migration 0002_business_catalog; added new permission seeds,
  append-only tax guards and deferred requirement for a catalog tax revision.
  Earlier migrations remain unchanged; no existing non-owner privileges expanded.
- API reuses session/CSRF/MFA/current tenant authorization and organization locks,
  bounded searches/pages, optimistic versions, archives and transactional audit.
  Extended mandatory SaaS MFA to customer/catalog managers and tax reviewers.
- Package compilation passed; API declaration checking found a non-portable inferred
  database getter type and it was given an explicit shared Database type. Next:
  integration tests, responsive UI and full regression checks. No migration has
  been applied to the user's development database in this batch.

## Phase 3 / batch 3 — UI and first regression pass

- Added business/GST setup, customer and catalog screens in the existing sidebar.
  Includes server-side search, archive filters, pagination, versioned saves,
  archive/restore, tax-review reference/history and responsive dialogs/member cards.
- Registration confirmation is an explicit fresh attestation on each save; no
  automatic portal verification or e-invoice eligibility determination is claimed.
- API/customer/catalog/profile reads validate transport contracts. Catalog reads
  use repeatable-read transactions so prices and classification revisions agree.
- First complete integration rerun passed 23/23 and unit tests passed 24/24.
  Fixed empty-profile transport to return a JSON envelope, and corrected the
  Drizzle read-only transaction option after compiler feedback.
- Added further tests for 51-record pagination, finite DB prices, mandatory catalog
  classification, stale tax review and new SaaS manager/reviewer MFA requirements.
- Next: rerun expanded integration suite, build and browser workflows; inspect UI,
  then migrate the local development DB and document upgrade/deployment privileges.

## Phase 3 / batch 4 — integration/browser acceptance and local upgrade

- Expanded integration suite passed 25/25, covering tenant boundaries, customer
  concurrency, archive/restore, literal search, 51-row pagination, exact prices,
  stale reviews, immutable history, audit rollback, DB guards and SaaS manager MFA.
- Chrome passed all 3 browser workflows: existing identity/RBAC/MFA plus business
  persistence, customer archive/restore, catalog review/invalidation/history and
  390px mobile layout/dialog/navigation checks. Inspected desktop/mobile catalog
  screenshots; all captured data is disposable fixture data.
- Added OpenAPI request/response contracts and bounded directory query descriptions.
- Applied reviewed migration 0002 to the development DB and reran it. Readiness
  passed. Before/after in-process hashes confirmed existing organizations/users/
  memberships/roles/grants/MFA/owner-recovery records were unchanged; no credentials
  or hash values were printed. Existing .env and owner files were preserved.
- Improved sidebar spacing so Phase 3 navigation fits without hiding settings.
  Next: final Edge/Chrome smoke/regression, types/lint/format/drift checks and docs.

## Phase 3 / batch 5 — final checks and directory error handling

- Final full workflows passed 3/3 in Edge and 3/3 in Chrome. Edge headless startup
  smoke passed against the migrated development database; final unit suite 24/24.
- Full workspace/test TypeScript and lint passed. Formatting found one newly
  extended test file; formatted it and reran formatting successfully.
- Drizzle generation reported no schema changes; checked-in 0002 snapshot and
  reviewed SQL match the current declarative schema. Prior migration files unchanged.
- Final review tightened failed-directory reloads to clear stale rows and permit
  retry, and prevents Next from exceeding the documented 10000 offset bound.
  Added a browser failure/retry regression; rerunning only the affected business
  workflow in both browsers plus frontend build/lint/format.
- Development frontend was not listening when checked. Checking service ports
  before starting the updated workspace without replacing existing processes.

## Phase 3 / batch 6 — final local acceptance (2026-10-28)

- Complete: business/GST setup; customer/catalog CRUD with archive/restore; exact
  prices; one-active registration; versioned classification/review history; explicit
  permissions/MFA; optimistic concurrency; transactional audits; responsive UI.
- Final evidence: production build; full workspace and test TypeScript; lint;
  24/24 unit tests; 25/25 isolated DB/HTTP tests; 3/3 full workflows in Chrome and
  Edge. Latest directory failure/retry workflow passed again in both browsers.
  Final formatting and whitespace checks passed after this documentation update.
- Drizzle generation found no schema drift. Development migration applied twice;
  existing identity/organization/grant/MFA/recovery fingerprints remained unchanged.
- Edge compiled-app smoke passed. Existing API on port3000 was preserved. Started
  Vite on port5173 (PID19828), with timestamped ignored .local logs/PID file. HTTP
  checks verified live readiness, frontend proxy and unauthenticated rejection of
  the new business endpoint. Real Chrome verified localhost:5173 sign-in and healthy
  API/database status without accessing private owner input or creating a session.
- PowerShell's localhost probe did not connect; direct loopback HTTP checks and
  real Chrome at localhost passed. Browser behavior is verified independently of
  that PowerShell probe.
- No new dependencies, invoice calculations/issuance/printing, payment/inventory
  features or production GST compliance claims. Earlier migrations, .env, existing
  owner input/recovery files and user's Git staging were not overwritten.
- Still unverified: remote GitHub CI and native Windows service/ACL/LAN HTTPS/
  firewall/reboot deployment behavior. Phase 4 covers the legally reviewed GST engine.
