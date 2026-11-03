# Review coverage

## Phase 6 continuation: controlled HTTPS certificate replacement

Started implementing protected certificate-pair replacement for an existing
dedicated Windows deployment, with staging/trust validation, shared installation
maintenance locking, retained original files and explicit recovery. The API's
fixed TLS paths and certificate issuer remain unchanged. No live certificates,
keys, trust stores, services, firewall/task settings, customer database or Git
staging are modified. Native deployment/power-loss acceptance remains postponed.

Implemented an operator-only replacement/inspect/recover CLI with strict protected
configuration and runtime/environment/script binding. It stages both private
pairs, validates real TLS trust/hostname on an isolated listener, and shares the
installation update lock. In-place writes preserve the existing service-read
file identity/ACL while service restart/jobs/ingress remain disabled. Private
restart, native process/listener/readiness checks and exact live leaf fingerprint
verification precede admission. No CA trust, issuer, environment, app version or
database selection is changed. Explicit recovery binds fresh inspected hashes,
owner/installation evidence and retained snapshots; success archives the exact
lock/receipts. Stale inspection fails before claiming; unknown or failed claimed
recovery remains stopped for inspection. Application recovery rejects the distinct
certificate journal header rather than guessing how to handle TLS files.

All 248 unit tests (35 files) passed, including six real loopback certificate
lifecycle cases, private NTFS/in-place identity, partial-pair repair, controlled
expiry rejection, wrong trust/hostname, maintenance exclusion and harmless native
transport/binding tests. Existing TLS checks/monitoring and issuer tests remain
green. The first compile identified the HTTPS socket's base type and an optional
journal reference; corrected explicit TLS/phase typing. Lint caught a type-only
import and was corrected. Safe mocked native tests and all 18 PowerShell parser
checks passed before final review; build/smoke, shared database regressions and
final native/static verification are in progress. No real SCM/firewall/task or
client trust-store action has been performed.

Final verification passed all workspace/test TypeScript, lint, repository
formatting and Git whitespace checks; production package/API/web builds and the
compiled frontend/assets/API/real-database/OpenAPI/Origin smoke passed. Both shared
database update/recovery integration files passed (9 tests). Safe mocked Windows
update/certificate and deployment tests, in-memory backup-task checks and parsing
of all 18 PowerShell files passed after the final adapter changes. The TLS audit
now permits read-only preflight before its operation directory exists; every
mutating native action still requires the protected journal. No unrelated full
database suite or browser UI suite was rerun because no schema/UI changed.

This completes locally verified controlled replacement/inspection/recovery for
the existing dedicated-service boundary. It does not complete Phase 6, install a
service on this laptop, acquire/automatically renew issuer certificates, deploy
client/CA trust or certify Windows crash/reboot behavior. Original/replacement
private pairs are retained only in protected test/operation storage, never logged.
All fixture keys are ephemeral. No production key/certificate, runtime environment,
customer data, machine deployment setting or Git staging changed.

## Phase 6 continuation: publisher issuance register

Started the next independent commercial-operations item in the connected plan:
an explicit protected publisher register for license issuance/renewal, preventing
stale predecessor and duplicate first-issuance mistakes. Native installer/artifact,
provider, signing-key custody and professional approval gates remain pending.
No production keys/licenses, customer database, deployment configuration or Git
staging are changed. Implementation and verification are in progress.

Implemented explicit new-register initialization with a stable expected UUID,
read-only audits of existing private directories, full signed history verification
and authoritative predecessor checks. Per-sequence file-content flush and atomic
no-overwrite hard-link commit prevent two concurrent issuances from publishing
the same next sequence. Register commit precedes delivery output; exact export
recovers delivery failure without private-key access or another issuance. Normal
issuer CLI calls now require --register and --register-id. Output paths inside
the store are refused; malformed/gapped history fails closed. No bootstrap of
existing commercial history, cloud issuer, replication or instant offline
revocation is claimed. Windows directory metadata/power-loss acceptance remains
unverified despite local NTFS tests.

The first focused run passed all 11 issuer/register tests, including actual CLI
init/issue/export, concurrency, stale/duplicate/gapped sequences, key rotation,
host replacement and output recovery. Lint caught a fixture cleanup guard throwing
directly in finally; moved the guard into a guarded cleanup helper, then lint and
test TypeScript passed. Added final output-path/pending-file safeguards and POSIX
parent-directory flushes; full regression checks are in progress.

Full local regression passed all 240 unit tests (34 files), workspace/test
TypeScript, lint, production package/API/web builds, repository formatting and
Git whitespace checks. Compiled frontend/assets/API/real-database/OpenAPI/Origin
smoke passed. Both existing isolated entitlement integration cases passed,
confirming consumer installation/lifecycle compatibility. The focused issuer/
register suite passed again (11 tests) after the parent-directory audit and again
after final CLI environment/path handling. No schema,
API route, UI, customer license policy or dependencies changed, so unrelated
database/browser/native deployment suites were not repeated in this batch.

This completes the locally verified publisher-register batch. Phase 6 remains
incomplete: deployed authority/custody and restore reconciliation, approved native
installer artifacts, actual Windows/power-loss acceptance, provider/certificate
operations and professional tax review are still release requirements. No Git
staging or privileged laptop deployment was performed.

## Phase 6 continuation: forward-copy updates and paired schema recovery

Continuing the connected execution plan with schema-changing update/recovery
support. Initial native installation remains dependent on approved distribution
artifacts and postponed Windows acceptance. This batch will migrate only generated
copies, bind the original schema to cutover evidence and restore matching original
metadata on explicit recovery. No live database migration, laptop deployment,
dependency upgrade or Git staging is authorized or performed. Implementation and
verification are in progress; no new acceptance claim is made yet.

Implemented matching-target migration admission, explicit forward migration of
the generated copy, original/target schema cutover evidence and schema-aware
original-state restoration. The database switch records and verifies the original
schema with both OIDs. Reviewed Phase 5/6 retained-runtime probes share the existing
structural checks; normal current API startup retains every original probe.
Unknown retained schemas remain blocked, and all-organization maintenance is
unchanged. A pre-licensing database cannot pass commercial update eligibility.

All 235 unit tests (33 files) passed, including different-schema orchestration,
migration-failure exclusion, wrong target bundle, recovery metadata and legacy
journal coverage. Focused real database adapter checks passed after rebuilding.
The new actual PostgreSQL forward/rollback drill passed and rejected altered old
migration history; it deliberately uses a Phase 5 fixture and does not claim a
licensed upgrade. Initial combined runs had intermittent adapter/CLI failures.
The historical-schema scenario now runs last and retains its actual old schema
for fixture deletion, rather than re-migrating/re-granting it for later tests.
One overlapping diagnostic run also invalidated an existing cluster-wide catalog
count assertion; subsequent full database runs were strictly serial. A failed
candidate cleanup left one generated test database/role, removed only after exact
name/owner and zero-connection verification. No runtime role privilege was widened
and no connection guard was relaxed to obtain a passing result.

The complete serial integration run passed all 64 tests (12 files), including
forward/rollback, retained-history tampering, runtime privileges and compiled CLI.
Temporary sanitized failure diagnostics helped investigate the intermittent runs
and are removed from product code. Initial compilation hit sandbox process-spawn
EPERM and passed with approved worker access. Workspace/test TypeScript and lint
passed; final production build, smoke and diagnostics-free focused regression
checks are in progress. A test-file formatting failure was corrected.

Final verification passed production package/API/web builds and the compiled
frontend/assets/API/real-database/OpenAPI/Origin smoke check. After removing all
temporary diagnostics, both real update/recovery integration files passed again
(9 tests); both orchestration/recovery unit files also passed again (10 tests).
Final lint, repository Prettier and Git whitespace checks passed. No temporary
diagnostic symbols remain. No browser UI or native PowerShell behavior changed,
so browser and mocked native suites were not repeated. Actual Windows installation,
service/file cutover, LAN and reboot acceptance remain postponed and unverified.

This completes the locally verified supported forward-copy/recovery batch, not
Phase 6 or a production installer. The initial installer/uninstall, approved
artifacts, signing/issuer custody, provider operations and professional tax review
remain release work. No customer database schema, environment settings, dependency
versions, UI, services, tasks, firewall, trust store or Git staging were changed.

## Phase 6 continuation: connected completion workflow and failed-update recovery

Recorded one connected execution plan in phase-6-execution.md, following the user's
request to reduce fragmented planning and continue through meaningful batches.
Started failed-update recovery against the existing protected journals, retained
database OIDs and native service selection. Native acceptance remains postponed;
no services, tasks, firewall rules, trust stores, production databases or Git
staging are changed by this work. Implementation and checks are in progress.

Implemented shared, exclusive initialization and compare-before-replace installed
state; update admission records and commits the selected version/root before
admitting users. Explicit recovery checks operation/installation identity,
bounded protected evidence, original signed files, actual database name/OID pairs
and required operator acknowledgements. Unknown states and lost rollback replies
never authorize a guessed swap or automatic retry. Successful recovery restores
matching database/application/state, verifies readiness and atomically archives
the whole exact operation lock with its receipts instead of deleting evidence.
Recovery does not require active maintenance to restore an installed release.

Focused tests passed: five recovery safety cases, protected-state tests, existing
staging/journal/transport cases and three real database adapter integration cases.
The integration now injects an admission failure after metadata commit, then
performs a real rollback and restores the previous metadata. Windows service
effects remain mocked. Added native original-service restore/start/readiness/
admission operations and safe mocked lifecycle checks. A read-only storage audit
now rejects inherit-only unsafe ACEs on the managed directory itself, protecting
new metadata children; real temporary NTFS regression confirms rejection without
silently repairing permissions. Its first fixture modifier required unavailable
SeSecurityPrivilege; changed only fixture construction to DACL-only icacls, which
passed without audit-policy privilege or system ACL changes. Lint caught test-only
type-import style and was corrected. Full regression checks are in progress.

Investigated the next initial-installer dependency using official vendor sources;
see windows-artifact-review.md. No approved wrapper is present, and cached PG
binaries are not proof of distribution/checksum approval. No binaries were
downloaded or executed, and no vendor/package/runtime versions were changed.

Final local verification passed all 230 unit tests (32 files), all 63 isolated
database integration tests (12 files), workspace/test TypeScript, production
builds, lint and compiled frontend/assets/API/database/OpenAPI/Origin smoke.
The three harmless transport tests passed again after native original-service
actions/DACL-only grant changes. All 18 PowerShell files parsed; mocked service/
recovery and deployment checks and in-memory backup-task tests passed. Final
repository formatting and whitespace checks passed. No browser UI changed,
so browser workflows were not repeated. Remote CI and native Windows service/
file cutover, installation, LAN and reboot acceptance remain unverified.

This completes the locally verified recovery/state batch in the connected plan,
not Phase 6 or a production installer. Initial native provisioning/uninstall and
schema-changing updates still need the reviewed artifact/service lifecycle and
postponed test environment; SaaS provider, issuer custody, signing and professional
tax approval remain separate release dependencies. No current customer database,
laptop service/task/firewall/trust/startup setting or Git staging was changed.

## Phase 6 continuation: database and Windows service adapter binding

Started binding the sequencer to actual backup creation/restore verification,
quarantined candidate/runtime provisioning, maintenance checks and transactional
database switching. This adapter initially accepts schema-preserving releases
only; schema-changing packages must fail before stopping writers. It preserves
the original database/application paths and writes private cutover intent with
database OIDs before activation. Candidate maintenance inspection temporarily
withholds runtime CONNECT, opens only the operator connection and reseals before
restoring that grant. Windows service/file operations and verification are in
progress. No live service/database/configuration or Git staging changed.

Bound real database adapter integration passed both cases: encrypted backup and
restore drill, quarantined clone, signed maintenance checks, dedicated runtime
privilege provisioning, transactional activation, retained original OID/database,
real runtime authentication/readiness and pre-stop rejection of schema-changing
packages. Only Windows service calls were mocked in this integration fixture.
Moved the fixture into the database workspace after its first run exposed that
the API correctly has no direct pg dependency; no dependency was added. Corrected
one test-only helper path before all three native transport/schema tests passed.

Implemented the Windows backend for existing dedicated GSTBillingApi services:
identity/binary/config/ACL checks, maintenance ingress block, backup task disable,
disabled/stopped service, retained service XML, candidate selection and read access,
manual/private startup, HTTPS/listener checks and restoration of prior admission
state. Scripts execute from verified bytes via stdin, with no operator environment
secrets inherited. Safe mocked PowerShell lifecycle/XML tests pass; they caught
and corrected PowerShell XML attribute/property shadowing in the strict parser.
All 18 PowerShell files parse. A harmless wrapper transport test executes real
verified helper definitions, never native machine operations.

Full regression passed all 222 unit tests (30 files) and all 62 isolated database
integration tests (12 files), workspace/test TypeScript and production builds.
Full typecheck initially hit sandbox child-process EPERM and passed when rerun
with approved process access. Lint caught a regex spacing style issue and a test
cleanup guard throwing directly inside finally; corrected both without changing
product behavior. Final lint, API rebuild and compiled frontend/assets/API/
database/OpenAPI/Origin smoke passed. Repository formatting and whitespace checks
passed again after the final native path-separation guard, along with test types,
API rebuild, lint and all three focused native transport tests. The guard rejects
in-place/nested release updates and journals inside signed application trees.
The native transport tests and mocked Windows service/
deployment tests also passed after strict response typing and pure XML-selection
coverage were added. Existing safe in-memory backup-task tests passed without
registration. No browser UI was changed, so browser workflows were not repeated.

No native service/firewall/task/registry/trust/startup operation was run. Test
resources were confined to generated fixture files and isolated databases/roles,
which were cleaned up. Initial installation, protected installed-state management,
schema-changing update orchestration, guided rollback/uninstall, remote CI,
commercial signing/redistribution and native host/LAN/reboot acceptance remain
unfinished or unverified. This batch provides actual bound operations as a host
library, not a production-accepted installer command; the Windows postponement
remains in effect and no Git staging was changed.

## Phase 6 continuation: assisted-update safety sequencing

Started the application-update coordination core after reviewing the existing
signed package, backup, candidate migration, runtime access and database switch
implementations. No native installer entrypoint or default/no-op Windows adapter
is provided. Concrete signed package verification runs before stopping writers
and again after candidate preparation. The host contract requires an exclusive
maintenance lock, durably flushed phase records, stopped ingress/writers/restarts,
a fresh verified backup, quarantined forward-migrated candidate, current maintenance
for all original/candidate organizations, controlled activation and private
readiness before admitting users. Failures after a stop attempt keep the service
stopped and preserve recovery copies; ambiguous COMMIT errors never imply rollback
or trigger automatic schema downgrade. No service, task, firewall, trust store,
production database/configuration or Git staging was changed.

First focused sequencing run passed all 18 cases. Added a concrete file-backed
exclusive journal with serialized fsync'd records, strict sanitized fields,
owner-token checks and retained locks after interruption/failure. Reused existing
release-staging protection rather than weakening ACLs or adding dependencies.
The first three journal tests failed the real ancestor ACL audit under sandbox
TEMP; moved generated fixtures to the existing staging tests' private Windows
profile base without changing production checks. All three journal tests then
passed. Added an end-to-end simulated activation failure with a real journal and
retry-blocking lock. A full run passed 217 tests but one native ACL fixture hit
the default five-second test timeout; used the existing release-staging tests'
30-second budget for the new native journal fixtures, without loosening production
checks. The next full run passed 218 tests; added a final owner-token tampering
case and reran all unit tests successfully: 219 passed across 29 files.

API production build, test/application TypeScript and lint passed. Final repository
formatting and Git whitespace checks also passed. There are no new
dependencies, package scripts, schema migrations, product UI or executable
installer entrypoints. Actual service/database actions in the coordination tests
are simulated; signature verification, signed maintenance expiry checks and
temporary journal/lock/NTFS protection are exercised for real. Isolated database,
browser and Windows service/LAN/reboot suites were not repeated because no bound
database/UI/native service implementation changed.

This is an implementation checkpoint, not completion of the requested Windows
installer. The remaining native service/database adapter must bind the existing
operator tools, persist actual recovery paths/OIDs and implement initial install,
activation/rollback/uninstall against approved deployment binaries and a dedicated
service identity. No default adapter is supplied that could silently claim those
operations succeeded. Disposable host/client acceptance and signing/redistribution
remain external gates; the user's Windows postponement stays in force. See
assisted-updates.md for exact contracts and unverified boundaries.

## Phase 6 continuation: offline update maintenance eligibility

User confirmed active maintenance at installation time and eligibility for every
organization on a shared offline host. Implemented a reusable signed-grant policy
and a host-only read-only database preflight, with no development bypass or
tenant/status filter. Rejects missing grants, wrong binding, sequence mismatch,
clock rollback, inactive entitlement and absent/expired maintenance. Uses a
repeatable-read database snapshot and disables row-security filtering rather than
silently checking a tenant subset. Does not update clock markers or grants.
No installer exists yet: preflight success is not durable installation authority;
the future updater must recheck under its controlled maintenance/write stop.
First sandboxed
Vitest invocation hit child-process EPERM before tests; rerunning with approved
test-process access. No dependencies, schemas, production configuration, services
or Git staging are changed.

Verification passed all 196 unit tests (27 files), the new isolated PostgreSQL
integration test, API production build, application/test TypeScript and lint.
The database test initially violated the existing active-owner constraint;
corrected the fixture to create an owner in the organization transaction, then
reran successfully. It verifies all three organization statuses, missing-grant
rejection and unchanged stored grants/clock markers. CLI unexpected-argument
rejection returned sanitized output and exit 1 before database access. Formatting
found one import-layout issue; final repository formatting and whitespace checks
passed after correction. Existing unrelated
integration/browser/Windows workflows were not rerun for this isolated host-only
addition. Actual installation, service control and Windows acceptance remain
unfinished or postponed; no package installation is authorized by this check.

## Phase 6 continuation: remaining release requirements review

Reviewed the Phase 6 acceptance list against PROJECT_CONTEXT.md, recorded user
decisions, licensing operations and signed-release boundaries. Added
phase-6-release-gaps.md with unfinished implementation, external prerequisites
and required completion evidence. Distinguished postponed Windows acceptance
from unfinished installer/update orchestration; neither is complete. Identified
maintenance update eligibility as the next locally testable implementation,
pending release-date and multi-organization policy clarification. No commercial
policy, provider, signing key or tax approval was invented. This batch changes
documentation only; application tests are not repeated. Prettier formatted the
three affected documents successfully and git diff --check passed. No application,
configuration, database or Git staging changes were made.

## Phase 6 continuation: HTTPS certificate validity and expiry

Reviewed remaining Phase 6 gates after the Windows postponement and dependency/
HTTP-cache checkpoint. The existing API reads TLS files without checking hostname
or certificate dates before startup; the Windows runbook explicitly leaves expiry
monitoring unfinished. Implemented direct-HTTPS startup validation and warnings
for the certificates actually loaded by the running API. No new operator tool,
production key, trust-store change or Windows deployment test is introduced.
Verification used ephemeral test certificates and isolated loopback TLS.

Focused verification passed 25 API/TLS tests before the final partial-wildcard
case was added. This includes real HTTPS with per-request test trust, wrong-host
client rejection, earliest chain expiry, malformed/key/CA/usage/date/SAN failures,
warning boundaries/daily deduplication, sanitized log fields and timer shutdown.
No machine trust was modified. Strict test TypeScript caught one optional-property
type mismatch in the fixture response shape; corrected it before the passing run.
Full regression verification is in progress.

The first full run passed 184 unit tests, 59 integration tests, all type/build/
lint/format checks and compiled smoke. A follow-up regression then reproduced
acceptance of a configured TLS private key beneath WEB_ROOT. Added fail-closed
configured/physical path checks for that unsafe overlap and a separate-directory
positive case. No private key was served or real configuration changed. Final
verification of this additional guard is in progress.

Final verification passed all 186 unit tests and all 59 isolated integration
tests, production builds, workspace/test TypeScript, lint, formatting and compiled
frontend/assets/API/database/OpenAPI/Origin smoke. Private key bytes are read only
after public certificate validation succeeds; no production key or trust store
was used. Temporary fixture files/keys were cleaned up. A TLS test prerequisite
is documented for existing installed OpenSSL; the API runtime uses Node built-ins
and no dependency/package-manager/runtime versions were changed.

No UI changed, so browser workflows were not repeated. No live database, user
configuration, Windows service, certificate trust, signing key or Git staging was
changed. Automatic renewal, client trust/CA replacement, real Windows/LAN/reboot,
remote CI and commercial deployment remain unverified or unfinished. The Windows
postponement and existing tax/issuer/hosting gates remain in effect.

## Phase 6 continuation: postponed Windows matrix and release/security review

Recorded the user's explicit decision to postpone native Windows deployment tests
on their 8 GB Windows 11 Home Single Language laptop. No VM, machine changes or
OS/hardware purchase are required. The actual installer/service/ACL/TLS/LAN/reboot
matrix remains unverified and is still a commercial release gate. The next
independent planned item is production dependency/API release-security review;
findings and verification will be recorded as work proceeds.

Production dependency audit completed successfully: pnpm audit --prod --json
reported zero advisories across 149 production dependencies. This is registry
coverage at the time of the check, not proof of absence of vulnerabilities.
Added the same production audit to CI without dependency changes or exceptions.
API review reproduced mixed-case routes returning HTTP 200 without Cache-Control
no-store: Express matched these routes but the cache middleware used a
case-sensitive prefix. Corrected the prefix boundary and added unit cases for
case variants/API errors plus authenticated-session/401 integration assertions.
The first new test invocation omitted its fixture setup; corrected that harness
before reproducing the actual two mixed-case header failures. Focused API tests
passed all nine cases after the fix. Full verification passed all 167 unit tests,
workspace/test TypeScript, production builds, lint and formatting. Final verification
also passed all 59 isolated integration tests and the compiled frontend/assets,
API/database readiness, OpenAPI and Origin-rejection smoke check. The extended
real-HTTP security case verifies no-store on authenticated mixed-case session
responses containing CSRF data and on unauthenticated 401 responses.

This was a focused production-dependency/HTTP-boundary checkpoint, not exhaustive
commercial security certification. No dependency versions, database schema/data,
credentials, service configuration, Windows trust or Git staging were changed.
No UI changed; browser workflows were not repeated. Remote CI, actual Windows
deployment, signing/issuer custody, SaaS provider operations and professional tax
approval remain pending. Windows acceptance is explicitly postponed, not waived.

## Phase 6 continuation: Windows deployment observations

The interrupted previous turn made no filesystem changes; the checkout was clean.
Reviewed the existing manual PoC service/PostgreSQL/TLS/firewall scripts and their
unverified VM matrix. Added a read-only host/client observation command and safe
tests for its acceptance/failure decisions. It checks private IPv4 DNS/topology,
approved executable hashes, PoC service/XML identity, service-owned API listeners,
loopback database listening, HTTPS health/readiness/frontend contracts and client
database-port inaccessibility. Client mode rejects same-machine observations.
Public/mixed/unresolved targets are not contacted; redirected/unhealthy/wrong-type
responses and unsafe XML fail closed. HTTPS uses platform certificate validation,
no proxy/redirects, bounded response size and request/read/body-time budgets.

All 15 PowerShell files parsed successfully. Decision/contract tests passed with
mocked DNS/HTTPS/service/process/hash/network observations and real secure XML
parsing, including DTD rejection. A separate real CLI invocation rejected a
credential-bearing origin before networking, returned exit 1 and sanitized JSON.
The existing native Task Scheduler in-memory definition checks, full repository
lint/formatting and Git whitespace checks passed. Added the safe deployment tests
to Windows CI; remote CI was not run here. No application code changed, so the
previous 162-unit/59-integration/build/smoke checkpoint was not repeated.

No service, task, trust, firewall, ACL, database, credentials or laptop startup
settings were changed. No UI changed or staging was modified. The operator guide
lists host/client commands and manual acceptance scenarios. Actual native service,
certificate trust/TLS, browser LAN access, automatic PostgreSQL/API startup,
reboot, effective deployment ACLs and signed installer acceptance remain
unverified/unfinished. A disposable VM, approved artifacts and second Windows
client are still unavailable; this prevents completing actual deployment tests.

## Phase 6 continuation: controlled recovery switch

Reviewed the existing recovery preparation/runtime-grant workflow and Phase 6
requirements. Implemented host-only activation and explicit rollback using
transactional database renames on the same local PostgreSQL instance. This keeps
application configuration unchanged and retains the previous database. Tests used
only disposable databases; no live switch, service installation or customer
configuration change was performed. The command
refuses connected clients and validates recovery identity/schema/runtime
permissions before activation. Focused verification passed two input-validation
unit tests and all five PostgreSQL switch integration tests, including real
post-switch API login, original/recovered OID/data preservation, explicit rollback,
operator locks, blocked clients and a late name collision that rolls back the
active database's connection flag. Compiled CLI activation/status/rollback and
sanitized output also passed. Full regression verification passed all 162 unit
tests and 59 integration tests, workspace/test TypeScript, production builds,
compiled frontend/API/database/OpenAPI/Origin smoke, full lint and formatting.
Both activation and rollback now probe target API-runtime readiness, including
a negative rollback case that keeps the recovered database active when the old
copy is unreadable. Final focused verification passed all five switch integration
tests using an ephemeral non-superuser database owner with CREATEDB and a separate
restricted API login. Final test TypeScript and focused lint also passed. No
product permissions were broadened, dependencies added or Git staging changed.

The operator guide documents writer/service maintenance, data-point review,
explicit rollback acknowledgement, retained databases, temporary probe windows
and catalog inspection after an uncertain COMMIT. Preparation audit events are
not presented as proof that activation committed. Native Windows PostgreSQL,
service/reboot/LAN, real power-loss recovery, customer cutover and remote CI remain
unverified. No UI/PowerShell scripts changed, so prior browser/task-definition
checks were not repeated. Phase 6 remains in progress pending deployment gates.

## Phase 6 continuation: recovery runtime permissions

Resumed the saved runtime-access command and tests after interruption. Existing
staged changes are preserved. The command targets only a confirmed, quarantined,
generated recovery database with matching installation/schema identity and no
sessions. It grants a reviewed API table/column policy to an existing dedicated
unprivileged login, rejects unsafe existing permissions and records a candidate
audit event. It does not create credentials, change active configuration or
perform service cutover. Added safe retry handling and checks for schema grant
options. Focused verification passed two unit tests and four PostgreSQL integration
tests, including real restricted-account login/writes and protected SQL denial.
Added explicit wrong-installation/open-candidate rejection checks to the same
suite for final verification. Docker was stopped and has been restarted for
isolated fixtures. All 160 unit tests, workspace type checks, production builds,
lint/formatting and both PowerShell checks passed. Final verification also passed
all 54 integration tests, including the additional identity/open-state cases,
and the compiled frontend/API/database/OpenAPI/Origin smoke check. Final test
TypeScript and focused lint passed after those test additions.

The initial sandbox Vitest launch failed with a subprocess EPERM restriction;
the approved normal-execution rerun passed without weakening application checks.
The operator guide documents dedicated role setup, explicit table/column grants,
safe retries and inspection after host/database outages. No UI changed, so browser
workflows were not repeated. Native Windows PostgreSQL/service/installer/reboot/
LAN, actual disaster cutover, hosting and remote CI remain unverified or unfinished.
No active business data, credentials, service configuration or Git staging were
rewritten. Test-only databases and roles are cleaned up by the integration suite.

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

## Phase 4 / batch 1 — scope and official-source review (2026-10-29)

- Working tree clean after Phase 3. Reviewed PROJECT_CONTEXT.md, architecture,
  Phase 3 contracts/classification history and the reserved billing-engine package.
- Checked official CGST valuation/discount/rounding, Rule 35, IGST place-of-supply,
  2024 B2C goods clarification and UT/Ladakh sources; references in phase-4.md.
- Recorded supported scenarios, exact rounding/discount/allocation policy and the
  distinction between source review and professional tax approval. No rate seeds,
  invoice issuance, API/UI endpoints or customer-data changes in this phase.
- Added shared calculation contracts and an internal workspace dependency so the
  pure engine can reuse validation/units/state/classification schemas.
- Next: exact arithmetic, guided jurisdiction, effective-date selection, calculation
  engine and comprehensive arithmetic/validation/property/regression tests.

## Phase 4 / batch 2 — engine implementation and first tests

- Added pure BigInt scaled arithmetic, half-up paise rounding, deterministic
  largest-remainder allocation, balanced rate-group component reconciliation,
  guided domestic POS/UTGST selection and reviewed effective-date selection.
- Implemented inclusive/exclusive prices, exact quantity/line discounts, eligible
  exclusive-value invoice discounts, bounds, safe errors, version metadata and
  explicit trusted override authority/provenance. Results never authorize issuance.
- Core shared packages compiled. Added synthetic golden fixtures, jurisdiction,
  malformed-input/authority/history/bounds tests and 300 seeded-cart reconciliation,
  immutability/permutation checks plus a maximum 1000-line cart. Tests underway.
- Test fixtures kept outside production source/output. No new external package,
  database migration, endpoint, UI or customer/credential edits.
- Next: fix test/type/lint feedback, independently cross-check arithmetic and
  execute the built package in actual browsers before application regressions.

## Phase 4 / batch 3 — arithmetic verification and reviewable example

- First unit run passed 101/102. The overflow fixture incorrectly used six decimal
  quantity places with KGS (three allowed); corrected it to OTH (six allowed),
  preserving the production precision guard. Full strict TypeScript and lint passed.
- Independently cross-checked 400 synthetic price/quantity/rate/discount cases using
  PowerShell System.Decimal (a separate decimal arithmetic implementation). All
  supply values, taxes, component totals, discounts and final totals matched.
- Added a runnable public synthetic example and package README documenting caller
  trust, dated complete histories, discount bases, exact money and issuance limits.
- Removed only stale generated fixture artifacts after moving helpers outside
  production src. Next: rerun unit suite, browser bundle parity, full app regressions.

## Phase 4 / batch 4 — resumed after usage-limit interruption

- Resumed from existing files and batch 3; no reset, replacement of prior work,
  credential access or staging changes. The earlier final-check command was not
  executed because automatic approval review could not complete at the usage limit.
- Source/example and earlier evidence retained: corrected suite 102/102, 400-case
  independent Decimal agreement, 403-case Node/browser parity in Chrome and Edge.
- Added tests already present at interruption: 600 allocation quota/capacity/
  permutation cases and special-service/e-commerce/unreviewed-baseline boundaries.
- Frozen offline installation passed without new external dependencies. Formatting
  applied to the last two new test files; final expanded unit/types/lint checks running.
- Next: application DB/browser/smoke regressions, example execution and final log.

## Phase 4 / batch 5 — resumed checks and development-service recovery

- Expanded unit suite passed 105/105. Full workspace/test TypeScript and lint passed.
- Formatting detected the newly appended progress log; it will be formatted after
  final evidence is recorded. No production-code formatting failure remains.
- Integration setup could not connect to 127.0.0.1:5432; all 25 tests were skipped,
  not passed. Docker Desktop's Linux engine was stopped (missing named pipe).
- Starting the existing engine/container without changing compose settings, .env,
  credentials, migrations or the persistent volume; then rerun the pending checks.

## Phase 4 / batch 6 — recovered service and regression results

- Docker Desktop engine started normally; the existing PostgreSQL18.6 container
  and volume were reused and became healthy on loopback port5432.
- Reran the previously skipped suites: all 25/25 isolated DB/HTTP integration tests
  passed. This supersedes the setup failure above; no tests were treated as passed
  while the database was unavailable.
- Runnable example passed: 250.00 supply value, 22.50 CGST + 22.50 SGST, 295.00 total;
  issuanceAllowed remained false. Production output contains only engine modules,
  declarations/maps; synthetic fixtures/tests remain outside dist.
- Confirmed no Phase 4 edits to API/web/database/migration/environment files and
  no Git staging changes. Final application build/browser/startup checks underway.

## Phase 4 / batch 7 — final engineering acceptance (2026-10-29)

- Resumed all pending work after the usage-limit interruption and preserved the
  implementation, test fixtures, existing files and Git staging. No code was reset.
- Passed: frozen offline installation; 105/105 unit tests; full workspace/test
  TypeScript; lint; production package/API/frontend build; 25/25 isolated DB/HTTP
  tests; all 3 application workflows in Chrome and all 3 in Edge; compiled startup
  smoke with healthy database/API, OpenAPI, assets and Origin rejection.
- Earlier engine-specific verification remains valid: 400 independent Decimal
  comparisons and 403 exact Node/bundled-browser parity cases in each browser.
  Tests include 300 seeded cart reconciliations/permutations, 600 allocation quota
  cases and a maximum 1000-line cart. No binary floating-point financial arithmetic.
- Runnable example verified 250.00 supply value, 45.00 GST, 295.00 total and the
  issuanceAllowed=false boundary. Production dist excludes tests/synthetic fixtures.
- Docker Desktop/PostgreSQL stopped during the interruption; the existing engine,
  container and persistent volume were started normally. Initial DB setup failures
  and skipped tests are documented above and were superseded by a full passing rerun.
- No new external packages, API/UI endpoints, business schema or migrations. Existing
  .env/owner files/credentials/customer data were not changed; Git staging unchanged.
- Final formatting and whitespace checks run after this log update. Phase 4 code
  and local engineering acceptance are complete; source review is not professional
  tax certification. Professional approval, invoice issuance/e-invoice controls and
  native Windows deployment/remote CI release gates remain explicitly unverified.

## Phase 5 � batch 1: scope and contracts (2026-10-29)

Read project context, current architecture, requirements, decisions and existing
business/identity/database/UI conventions. Phase 4 is committed; starting tree was
clean. Defined bounded invoice draft/finalize/reversal contracts and presentation
transport. Added granular invoice/override permission keys; existing grants will
not be expanded. Recorded source review, numbering, immutable snapshots, and the
non-bypassable pending professional issuance gate in phase-5.md. Verification:
repository inspection only so far; compilation/integration follow with persistence.

## Phase 5 � batch 2: persistence/API and billing workspace

Added reviewed generated invoice/series/financial/snapshot schema plus custom DB
immutability, rollback-safe counter and deferred reconciliation guards. Implemented
server-derived calculation, versioned/idempotent drafts, reviewed-preview digest,
atomic gated finalization and linked full-credit drafts. Added Invoices navigation,
customer/catalog search, quantities, line/invoice discounts, authorized price override,
server totals and escaped versioned A4 draft rendering with external print CSS.
Commercial gate remains enforced; existing roles receive no automatic new grants.
Compilation/tests are running; no claim of verified workflows yet. General partial
credits/debit/cancellation and configurable logo remain outside the implemented boundary.

## Phase 5 � batch 3: initial verification and corrections

Unit checks passed 110/110. First isolated integration run passed all seven invoice
cases and 24 existing cases; one host-CLI test rejected the invocation because direct
`pnpm exec vitest` lacks the documented package-script context (`npm_execpath`).
Rerun through `pnpm test:integration` is required; no production failure inferred.
Fixed compiler-discovered JSX closure and portable DB getter annotation; internal
renderer linkage was installed offline with no downloads. Existing development
PostgreSQL container was checked healthy. Added real-gate, tenant/CSRF, stale-version,
permission-revocation, rollback, immutable history and full-reversal integration tests.
Only test-local module spies exercise issuance machinery; production has no bypass.
Chrome/Edge browser invoice tests and final type/lint/build checks remain pending.

## Phase 5 � batch 4: regression findings and hardening

Documented integration command passed 32/32, including host CLI and all seven
initial invoice cases; production API/frontend build passed. First Chrome run passed
existing identity/business flows and exposed ambiguous wrapping labels on discount
selectors; fixed explicit accessible names before rerunning. Preserved custom
delivery addresses after save, exposed saved item names, added runtime response and
OpenAPI schemas, and replaced per-line catalog/history queries with bounded batch
reads. Added authorized tax/place override UI and provenance/baseline integration
coverage. Strengthened draft/finalized non-null constraints and deferred financial
reconciliation to compare individual lines/components with the snapshot. Added
missing-snapshot/corrupt-row rollback tests. Final reruns pending; no hardware
printer, LAN HTTPS/service install or professional compliance validation claimed.

## Phase 5 � batch 5: browser acceptance and safe local migration

TypeScript, lint, 110/110 unit tests and 34/34 integration tests passed; full production
API/web build passed. Drizzle generation reports no schema changes. After fixing
explicit labels for discount selectors and saved note/terms fields, all four browser
workflows passed in Windows Chrome and Edge. Invoice workflow verifies exact INR259.60
from quantities/line/invoice discounts, save/reopen, draft warning, escaped note text,
print action and mobile width. A synthetic 100-row A4 document produced a multi-page
browser-captured PDF in both browsers; repeated table-header CSS was checked. This
is browser rendering proof, not hardware/spooler or statutory document certification.

Before development migration, created ignored `.local/backups/gst-phase5-before-20261029.dump`
(62,444 bytes) and checked its pg_restore archive list. No restore claim. Applied
0003 explicitly through pnpm db:migrate; before/after aggregate organization/user/
membership/role/grant/assignment/customer/catalog/profile/registration/classification/
review/audit counts matched. New invoice tables remain empty, with no issued invoices.
Credentials, customer records and existing grants were not changed. HTTP/assets/real
readiness/OpenAPI/Origin smoke passed; final browser smoke result and final formatting/
whitespace/test-type checks follow. Git index remains untouched.

Full Phase 5 is not marked complete: real issuance remains blocked by professional
calculation/document/compliance approval and e-invoice eligibility. Partial/debit
corrections, cancellation policy and configurable logo remain unfinished. Implemented
full-credit machinery is exercised only with synthetic test release spies. No runtime,
HTTP, environment or UI bypass of the real issuance gate was introduced. Native
Windows deployment, hardware printers and remote CI remain separate unverified gates.

## Phase 5 � batch 6: final checkpoint

Final test TypeScript compilation, lint, whole-repository formatting and Git whitespace
checks passed. Compiled-app browser smoke also passed: sign-in rendered and live API/
PostgreSQL status was healthy. Final Chrome and Edge runs each passed all four workflows,
including multi-page A4 capture. No external dependency was added (lockfile changes
only link internal billing/renderer workspaces). Development migration is applied;
restart pnpm dev and open Invoices as owner. All source changes remain unstaged;
no commit, index reset, credentials rewrite or existing-data deletion was performed.
Phase 5 remains explicitly partial for the release/policy and logo gaps listed above.

## Phase 5 continuation ? batch 7: resumed unfinished scope

Preserved the user-staged Phase 5 work and resumed the in-progress contract/logo
changes without altering the index. Added a pure original-value correction policy:
partial credits consume remaining original/debit values and residual component paise;
debits retain original classification and balanced group rounding. Added correction
draft create/update, append-only cancellation records and idempotent server methods.
All issued operations still enforce the existing release gate. Added bounded PNG
logo validation/upload, snapshot data and safe renderer support. Generated additive
0004; the applied 0003 migration is unchanged. Integration, UI and regression checks
follow; no completion claims at this checkpoint.

## Phase 5 continuation ? batch 8: verification and edge-case fixes

Initial unit run passed 114/114, including 300 sequential partial credits conserving
component paise, debit balance expansion and bounded PNG validation. Fixed one lint
finding in the new arithmetic code. Compiler and lint then passed. Initial integration
run passed 37/38; the remaining logo test incorrectly read the GET response wrapper
as the profile input. Fixed the fixture to read body.profile (no weakened validation).
Added cancellation/credit race, editing/version, current-release gate and frozen-logo
integration coverage. UI now distinguishes value adjustments from physical quantities,
shows debit-note labels, supports editable corrections and safe discard/cancellation,
and tests browser PNG upload, preserved draft cancellation and correction dialogs.
Tests for issued-document browser controls use explicit read/submit fixtures; real
backend transactions are tested separately with test-local release spies.

## Phase 5 continuation ? batch 9: engineering verification and permissions

Fresh shared-package compilation, lint, 114 unit tests, 38 integration tests and the
production build passed. A previous build caught a stale generated permission type
while the new cancellation permission was being added; rebuilding shared packages
resolved it. Cancellation now uses its own grant and privileged SaaS MFA boundary;
existing role grants are not expanded. Added DB original/classification/cumulative
balance guards and rejected issued-note cancellation in favor of a counter-adjustment.
Correction snapshots retain original/prior-note digests for reconstructable balances.
Chrome verification of all five workflows (including logo/discard and correction
forms) is running; issued controls use explicit frontend fixtures, not real issuance.

## Phase 5 continuation - batch 10: final acceptance and preservation

Final unit run passed 115/115; integration passed 38/38. TypeScript, lint and full
API/frontend production build passed. Chrome and Edge each passed all five workflows,
including logo decode/print, draft discard/reopen, A4 pagination and versioned
correction dialogs. Actual credit/debit/finalization/cancellation transaction behavior,
residual balances, races, immutability and real gates are covered in isolated DB tests;
issued UI controls use explicit test fixtures and never bypass production policy.

Saved a new private custom-format backup in .local/backups (unique filename) before
0004, validated its archive list, then applied the reviewed migration explicitly.
Existing rows in business, financial, identity, credential, audit and grant tables
matched their before/after counts and fingerprints; intended new schema fields were
excluded from that comparison. No data/credentials/grants were rewritten. Applied
0003 remains unchanged. New invoices.cancel is defined without granting non-owners.
Compiled HTTP/assets/readiness/OpenAPI/Origin and Edge sign-in/health smoke passed.

The final formatting run found two updated TS files needing formatting; both were
formatted, and the final compiler, lint, repository formatting and Git whitespace
checks passed. The previously unfinished correction/cancellation/
logo engineering scope is complete within phase-5.md boundaries. Real issuance and
issued cancellation stay disabled pending professional approval. Hardware printers,
Windows service/ACL/LAN HTTPS/firewall/reboot, restore and remote CI remain unverified.
User-staged work is preserved; continuation changes remain unstaged and no commit was made.

## Local dependency repair: Windows Argon2 installation

The system Node 22.13.0 process exited with Windows access-violation code
-1073741819 when loading the installed Argon2 Windows prebuild. The same binary
loaded successfully under the existing local Node 24.22.1 runtime. Completed
`pnpm install --offline --frozen-lockfile` using local Node 24.22.1 and pnpm
10.34.9 (exit 0), then `pnpm rebuild argon2` (exit 0). An in-memory Argon2id
check passed native loading, hashing, correct-password verification and
wrong-password rejection. No credentials, database data, dependency versions,
lockfile or staging were changed. The system-default Node/pnpm were not upgraded;
future terminals must select the working toolchain. API connectivity remains a
separate follow-up and was not tested in this repair.

## Local API connectivity verification after runtime repair

Verified the already-running development services without restarting them:
direct API and proxied frontend liveness returned 200. The existing private
Chrome verification script passed proxied liveness (200), database readiness
(200), anonymous session rejection (401), and rendered sign-in/operational
indicators with no workspace connection error. No real account sign-in was
attempted. No application code, configuration, credentials or staging changed.
The earlier system-Node native-module crash explains why the API watcher could
remain running without an API listener; connectivity now passes after selecting
the working runtime. Automatic startup after terminal/Docker shutdown is not
provided by the development setup.

## Invoice validation: actionable customer registration mismatch

A read-only aggregate check found the sole active local customer has a GSTIN
state prefix different from its saved billing-address state. Invoice preparation
already rejects this inconsistent master data, but previously returned only
`INVALID_INPUT`. It now returns `CUSTOMER_REGISTRATION_MISMATCH` with guidance to
correct the customer GSTIN or saved billing address, explicitly distinguishing
the invoice delivery address. No local customer or invoice data was modified.

All 14 invoice integration tests passed in a disposable database, including a new
regression covering preview/save rejection, no persisted draft on rejection, and
successful draft creation after correcting synthetic customer data with a
different delivery state. The first test invocation lacked the explicit test
database URL and ran no tests; the documented migration connection was then
provided privately for the successful run. API type checking, targeted ESLint,
and Git whitespace checks passed. Existing staged changes were preserved.

## Invoice form: explain conflicting customer states before submission

Selecting a customer whose GSTIN prefix conflicts with its saved billing-address
state now shows an inline alert below Bill To naming both states and their codes.
The alert directs the user to correct the customer registration details in
Customers and reselect it, and explains that the invoice delivery address is
separate. Preview/save also stop locally with this explanation instead of sending
a known-invalid request. Existing server validation remains authoritative for
saved drafts and concurrent master-data changes. No business data was rewritten.
Web type checking, targeted ESLint and Git whitespace checks passed. This UI
follow-up was not separately exercised in an authenticated browser session.

## Phase 6 batch 1: authenticated backup artifacts

Read the complete root context/prompt and current architecture/phase notes;
working tree was clean at start. Added bounded AES-256-GCM streaming backup
artifacts with authenticated installation/schema/version/checksum/count metadata,
unique nonces, no-overwrite publication and private temporary plaintext. Four
artifact unit tests passed: round trip, wrong key/identity/schema, metadata/data/tag
corruption/truncation and invalid input/no-overwrite cleanup. Initial sandbox test
launch failed with EPERM; rerun with required subprocess permission passed.
Database type checking and eight-file PowerShell syntax checks passed.

## Phase 6 batch 2: real PostgreSQL backup/restore verification

Added host-only backup CLI and NTFS-protected key creation. A repeatable-read
exported snapshot binds dump and table counts. Restore checks use only a generated
disposable database; no existing database name can be supplied for overwrite.
Verified a PostgreSQL 18 Docker dump/encrypt/decrypt/restore round trip on Windows,
including ACL setup, matching restored counts/readiness, wrong-key rejection,
temporary cleanup and unchanged source fixture. The first real test exposed an
empty PGSERVICE setting; removing inherited libpq configuration fixed it and the
test passed. Added exact migration-history checks; final artifact tests (4) and
migration-aware real restore drill (1) passed. Database/test TypeScript and
targeted ESLint also passed.
CI is configured to use its service container; remote CI remains unverified.

User confirmed no code-signing certificate or SaaS provider is currently available.
Keep these external and do not provision paid services. Grace policy question is
pending. Remaining Phase 6 work is tracked in phase-6.md; official issuance gates
and customer data remain unchanged. Native PostgreSQL restore/cutover, scheduled
execution, installer signing/service/reboot, provider recovery and commercial
license/subscription integration are not yet complete.

## Phase 6 batch 3: signed entitlements and immediate read-only policy

User confirmed immediate read-only at trial/subscription expiry (no grace).
Added strict shared claim/envelope contracts, Ed25519 authenticity verification,
14-day trials, offline host/organization binding, SaaS organization binding,
sequence/clock rollback checks and perpetual-maintenance independence. Five
cryptographic/policy unit tests passed. Added operator-only audited grant import,
per-organization business-write enforcement after authentication/RBAC, and safe
read-only UI behavior without clearing the authenticated session. Production
fails closed without trust; existing unconfigured development stays writable.
HTTP integration passed for missing/expired grants, active perpetual rights after
maintenance expiry, preserved authorized reads, idempotent installation, rejected
rollback/wrong-host grants and unchanged data after rejected writes.

Before additive migration 0005, created a private NTFS-protected recovery key and
encrypted backup of the existing local database, then successfully restored and
verified all 26 archived tables in a separate temporary DB. Known Phase 5 schema
prefixes are supported for pre-upgrade backups; unknown history is rejected.
Applied 0005 and verified counts/fingerprints of all 23 existing business,
identity, financial, audit and grant tables unchanged; live sessions/throttle were
excluded because normal API use can update them. No existing permissions or
credentials were rewritten. Recovery materials remain ignored under .local;
an off-device copy remains the operator's responsibility.

Both new integration files passed (2 tests total), plus API/test TypeScript.
New workspace status presentation and final broad regression checks remain next.
Issuer/online activation, provider automation, signed installer/update, scheduling
and controlled disaster-recovery cutover remain unfinished Phase 6 work.

## Phase 6 batch 4: job reporting and signed update-package preflight

Added a one-shot PowerShell backup job using an approved Node executable hash,
private keys/configuration, exclusive overlap lock, unique encrypted artifacts,
full disposable restore and atomic last-success/failure status. Successfully ran
it on this Windows host with Docker PostgreSQL tools. No scheduled task was
registered; native-tool and unattended/reboot execution remain unverified.

Added host-only signed release-package preflight: domain-separated Ed25519
signatures, bounded manifests, version/known-schema checks, complete SHA-256 file
verification and rejection of path traversal, reserved names, alternate streams,
case collisions, unexpected files and Windows directory junctions. Five tests
passed. No package files were executed; no installer/update was installed.

Broad verification found one fsync-heavy filesystem unit test exceeding its
five-second default while builds ran concurrently; its local timeout is now 30s.
The subsequent full unit run passed 125 tests (before the five release tests were
added). Full integration initially lacked pnpm's host-CLI environment; the
documented `pnpm test:integration` rerun passed all 41 tests. Initial browser run
passed four workflows and reached the new read-only flow, but its final locator
matched both h1/h2; corrected it to the page-level heading. Final browser rerun,
new pre-upgrade-restore test and complete checks remain next.

## Phase 6 batch 5: recovery failure checks and runtime consistency

Verified the one-shot Windows job's failure path using a deliberately nonexistent
Docker container: it exited 1, recorded failure, preserved the previous successful
timestamp and every existing archive. A subsequent real backup/restore job passed.
Added explicit current-release compatibility reporting for restored backups and
a test covering pre-upgrade Phase 5 archives without claiming current API readiness.
Readiness now checks the entitlement table as part of the current schema.

Full compiler, lint, build, formatting, whitespace and nine-file PowerShell syntax
checks passed. Production dependency audit reported no known vulnerabilities.
Workspace engine requirements now match the verified Node 24.22.1+/pnpm 10.34.9
baseline, preventing normal installation under the previously crashing Node 22
toolchain; system installations were not changed. Backup archives are excluded
from Git and Docker contexts. The latest complete unit run passed 130 tests.
Final integration and Chrome/Edge runs are in progress. User-staged changes remain
staged; no commit or index rewrite was performed.

## Phase 6 continuation: final local checkpoint (2026-10-30)

Full unit run passed 130/130 and isolated integration passed 43/43. Chrome and
Edge each passed all six workflows. The extended read-only browser workflow
verifies disabled business editing for known expired state, re-enabling after
renewal, and retaining authorized historical access when a later write is rejected.
RBAC permissions are not rewritten to implement licensing. All production
entitlement/issuance checks remain server-side and independent.

API/web/test TypeScript, lint, production builds, compiled HTTP/assets/database/
OpenAPI/Origin smoke, migration drift and nine-file PowerShell syntax checks
passed. Final API smoke passed after the UI change. Both old Node and old pnpm
were explicitly rejected by offline lockfile-only engine checks; the lockfile
remained unchanged. Release tests passed again after adding a case-insensitive
reserved-manifest-path check. One late test-array formatting warning was corrected;
the final full lint, formatting and whitespace rerun passed.

Moved the CI backup-container expression to integration-step environment, where
GitHub's job context is available; remote CI remains unverified. Reference:
[GitHub context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability).

This is a verified local hardening checkpoint, not completion of commercial
Phase 6. Remaining work requires externally provisioned signing/issuer/hosting
and an elevated disposable Windows/LAN test environment: commercial signed
installer/update and controlled cutover, service/reboot/native PostgreSQL and
unattended scheduling, online activation/self-service SaaS onboarding and provider
renewal/backup operations. No production private key, paid service, scheduled task,
machine-wide service, certificate trust or firewall rule was installed. Existing
business data and user-staged changes are preserved; recovery material is private
under ignored .local paths and still needs an operator-managed off-device copy.

## Windows terminal toolchain selection repair

The user's terminal still selected system Node 22.13.0 and pnpm 9.15.4 after the
Phase 6 engine checks were enabled. Preserved those checks and system installs.
Added a Windows helper that validates/reuses compatible existing distributions,
copies them into a stable ignored .local/toolchain location without overwriting
an existing setup, and selects its bin directory for the current shell. Added
workspace VS Code terminal environment configuration for future terminals and
documented the one-command helper for existing/external PowerShell sessions.
No new runtime/dependency version or credential was introduced.

Verified helper reuse and a fresh PowerShell process with the resolved VS Code
environment: Node 24.22.1 and pnpm 10.34.9 resolve from .local/toolchain/bin.
The first db:up attempt passed engine checks but found Docker Desktop stopped;
started the already-installed application and successfully brought PostgreSQL
to healthy state. Argon2 native/hash verification, ten-file PowerShell syntax,
targeted formatting and Git whitespace checks passed. Actual VS Code terminal creation remains
a user action; existing open terminals cannot inherit another process's PATH.

## Phase 6 continuation: backup scheduling and health

Added explicit operator-configured daily/boot Task Scheduler definitions and
registration under a dedicated ordinary local account. Registration refuses an
existing task, mismatched credentials, direct local administrators, reparse paths,
untrusted writable dependencies/ancestors and public-readable private configuration.
No account creation, ACL modification, archive pruning or Docker scheduling occurs.
Definition generation is the default; actual registration requires elevation and
the dedicated account credential. Added CI definition checks.

Verified definition settings, escaping and unsafe-input rejection, including
loading the XML through the actual Windows Task Scheduler COM parser in memory.
Twelve PowerShell files parse successfully. No task was registered or executed.
Added backup:health with an explicit maximum age and nonzero status for failed,
missing, malformed, stale, old-schema or absent-artifact backups. Six focused tests
passed (the sandbox blocked Vitest subprocess startup; the approved subprocess
rerun passed). Database type checking, full regression checks and the final date
validation adjustment are being verified next. Native PostgreSQL, privileged task
registration/ACL provisioning, unattended/reboot execution and actual external
alert delivery remain unverified. No business data or staging was changed.

## Phase 6 continuation: publisher license tooling

Added publisher-only license:issue tooling, excluded from Docker build context
and not imported by the customer API/web build. Requires an externally supplied
encrypted Ed25519 PKCS8 key matching the approved public trust map. First issuance
is explicit; renewals/transfers authenticate the previous grant, preserve the
organization/edition, require the next sequence and a new entitlement ID, and
cannot issue a second trial. No production key, grant or commercial ledger was
created. The publisher remains responsible for identity/transfer approval and
the authoritative issuance register; this is not an online activation service.

Six issuer tests passed, including a real isolated CLI subprocess with ephemeral
encrypted keys, customer-verifier compatibility, protected failure logs and
no-overwrite behavior. Six backup-health tests passed again. Type checking and
targeted lint passed. Final full unit/build checks are next. Existing business
data, user credentials, configuration, Git index and billing compliance gates
are unchanged.

## Phase 6 continuation: publisher release signing

Added release:sign publisher tooling that inventories the actual staged tree,
validates version/schema/runtime metadata, signs with an approved encrypted
external key, refuses existing manifests and uses the real customer verifier
before success. Shared inventory also rejects case-colliding directories and
unknown files/sizes before reading their contents in customer verification.
Issuer tools remain outside customer API/web imports and the Docker context.

Seventeen focused license/release tests passed, including both actual publisher
CLI subprocesses with ephemeral encrypted keys, unchanged existing manifests,
tampering, rejected key/metadata/secret paths and native Windows junctions.
The prior full run passed 142 unit tests before these six release-publisher tests
were added. Full final checks are in progress. Application-level release signing
does not implement Windows Authenticode, privileged installer/update/recovery
cutover, online activation, SaaS onboarding/provider renewal or deployment.
Those remain unfinished. No production signer, license, service, task, certificate
trust, firewall rule, database or customer configuration was changed.

## Phase 6 deployment prerequisites confirmed

The user confirmed no disposable Windows VM/second client is available. Code-signing
credentials and a SaaS provider were already unavailable. Therefore the next
privileged Windows installer/service/reboot/LAN acceptance work cannot be completed
or claimed on this development laptop. Signed installer/assisted update/cutover and
SaaS onboarding/provider operations remain unfinished implementation as well as
deployment validation; these are not hidden behind a claim of Phase 6 completion.
No machine-wide substitute or weaker tax/certificate/permission gate was introduced.

During final review, bound backup health to the recorded authenticated schema
digest and the running release's migrations. A recently successful old-release
backup cannot appear current after a schema upgrade. Restore verification now
returns that digest and the Windows job records it. Existing status files without
the digest require a new verified backup, not a fabricated success marker.

Final verification: all 148 unit tests passed; both isolated PostgreSQL backup/
restore integration tests passed against the existing healthy development
container, including digest reporting and the older-schema case. Full workspace
type checks and API/web production builds passed; the final database rebuild
includes digest reporting. Twelve PowerShell files parse, the native Task Scheduler
in-memory XML check passes, and mocked ACL checks reject unsafe owners, ancestor
replacement, writable child dependencies and reparse points. Registration,
unattended execution, native PostgreSQL, reboot/LAN and remote CI remain unverified.
The prior 43-test integration and Chrome/Edge browser checkpoint is historical;
those full suites were not repeated for these operator-only additions.

Final full lint/Prettier and Git whitespace checks passed. The initial sandboxed
recursive type-check command encountered Windows subprocess EPERM; the approved
full rerun passed. No check failure remains unresolved for this local batch.

## Phase 6 continuation: quarantined recovery candidates

Implemented host-only backup prepare-recovery with explicit installation UUID
confirmation. It authenticates/decrypts a current-schema backup, restores only to
a newly generated database with PUBLIC connection privileges removed, verifies
migration history/table counts/readiness, invalidates copied login sessions and
appends an audit event in the candidate only. The retained candidate denies all
new database connections; live configuration/runtime grants remain untouched.
Ordinary verify still removes its disposable database. Unknown/old schema recovery
preparation fails without automatic migrations or a schema downgrade.

Focused unit, real PostgreSQL isolation/quarantine/failure and compiled CLI checks
passed: two unit tests and five real PostgreSQL tests, including the compiled CLI,
denied candidate connections/PUBLIC privileges, session invalidation, source
preservation, wrong-key/identity/corruption cleanup and old-schema rejection.
Database build, test TypeScript and targeted lint passed. No live recovery
candidate or customer-data operation has been performed; integration fixtures
are random isolated databases. The Windows VM,
code-signing, hosting and professional tax-review limitations remain unchanged.

## Phase 6 continuation: protected release staging

Added release:stage: signature/file preflight, a new private staging directory,
bounded copy/hash validation of the signed file list and final exact-manifest
verification. The Windows path applies NTFS ACLs before writing and checks owners,
reparse points and ancestor replacement permissions. POSIX restricts modes/owners
and handles root-owned sticky temporary directories. Downloads, existing staging
directories and unrelated operator material are never overwritten. No staged
code is executed and no service/configuration/cutover is changed.

All six staging tests passed in the full unit suite. The initial Windows
success-path tests correctly rejected the sandbox's
TEMP directory because another account has Modify/DeleteChild permissions there.
The fixture now uses a fresh directory under private Local AppData; the production
ancestor check was preserved, and all original staging/verifier/publisher checks
passed. Added a deterministic same-size mutation after preflight to exercise the
copy-time hash check and generated-child-only cleanup. This is locally testable
engineering, not Windows installer/reboot or
commercial deployment acceptance. The missing VM does not block these filesystem
or isolated database tests.

Final continuation verification: all 156 unit tests and all 46 integration tests
passed. The integration command was rerun through documented pnpm test:integration
after a direct Vitest invocation omitted npm_execpath, which the pre-existing
host CLI test requires (45/46 passed on that first invocation). No product change
was made to hide the harness error. The final run also checks an authenticated
archive with inconsistent counts, forcing failure after database creation/restore
and proving generated-database cleanup. Candidates are connection-disabled before
failure cleanup, so an interrupted DROP does not reopen them to new connections.

Full workspace/test TypeScript, production API/web builds, compiled frontend/API/
database/OpenAPI/Origin smoke, full lint/Prettier, Git whitespace and both Windows
script checks passed. One type-import lint finding and an integration-file
formatting warning were corrected before the final checks. The final database
package rebuild includes the cleanup hardening. No browser UI changed; Chrome/
Edge workflows were not repeated. POSIX staging branches/remote CI and native
Windows service/installer/LAN/reboot/unattended acceptance remain unverified.
User configuration, active business data and the Git index were preserved.

## Phase 6 continuation: explicit forward upgrades of recovery copies

Added an opt-in --upgrade-to-schema target for host-only recovery preparation.
The target must exactly match the installed trusted release's migration digest.
Without it, old backups still fail closed. The backup is authenticated and its
restored migration prefix/counts are checked before applying any migration to
the generated owner-only candidate. Only this release's existing SQL is used;
there is no caller-selected migration directory or downgrade path. The final
history/readiness must match the confirmed target before quarantine is retained.
Audit/result metadata distinguishes backup and upgraded schema digests.

Added read-only db:schema tooling to print the release-file digest without
database credentials or a connection. Initial focused verification passed four
unit tests and all nine backup/recovery/upgrade integration tests. This includes
old-backup/compiled CLI upgrades, original database/archive preservation and real
migration-failure cleanup. Final verification passed all 158 unit tests, all 50
isolated integration tests and the compiled runtime smoke check. Full type/build/lint/format checks and
both PowerShell checks passed after removing a redundant counter initializer.
No live database migration, service change, runtime grant rewrite or invoice
compliance bypass was performed. Windows deployment/VM and hosting gates remain.

The upgrade result reports the actual candidate table count and both original/
target digests. A deliberately conflicting view in an isolated fixture proves
migration failure cleanup after restore without touching repository SQL or the
original database. Current-schema preparation and ordinary verification remain
covered by the full suite. No browser UI changed, so browser workflows were not
repeated. Native Windows PostgreSQL/service/installer/reboot/LAN and remote CI
remain unverified. Existing development data/configuration and Git staging were
preserved; no live recovery candidate was retained outside test fixtures.
