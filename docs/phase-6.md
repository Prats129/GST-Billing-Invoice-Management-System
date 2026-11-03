# Phase 6: commercial hardening

Status: implementation in progress. No commercial release or tax-compliance
approval is implied. Phase 5 issuance gates remain unchanged.

See [remaining release work](phase-6-release-gaps.md) for the reviewed gaps,
required inputs and completion evidence. No extra product phase is proposed.

## Execution order and acceptance

1. Encrypted, authenticated custom-format PostgreSQL backup artifacts, bounded
   manifest validation, host identity checks and restore verification against a
   new database. Never overwrite a customer database during a drill. Verify
   corruption/wrong-key failure and a real dump/restore round trip.
2. Host-operated backup/restore commands and operational documentation. Explicit
   storage/key separation, restricted access, failure reporting and scheduling.
   Retention remains operator-configured; do not invent a commercial policy.
3. Signed offline entitlement verification and trial/read-only lifecycle, separate
   from RBAC. Production signing keys remain external. Perpetual maintenance
   expiration must not disable billing. User confirmed immediate read-only on
   trial/subscription expiry, with no grace period.
4. Signed installer/update workflow with backup, version checks, maintenance and
   recovery; validate Windows service/ACL/HTTPS/firewall/reboot on a disposable VM.
5. SaaS subscription/operator recovery and release/security checks, with actual
   provider configuration, retention/cost and restore evidence before release.

External release dependencies: professional tax review, code-signing credentials,
approved redistributable PostgreSQL/service binaries, a disposable elevated Windows
test environment with LAN client and SaaS provider.
Provider/payment integrations and published prices are not silently selected.

Read-only recovery must retain existing authorization and tenant isolation. Full
shared-database restoration is host/platform-operator-only, never a tenant API.
No UI or environment switch may bypass the invoice compliance gate.

## Postponed Windows acceptance

The user explicitly postponed actual installer/service/ACL/TLS/LAN/reboot testing.
Their current laptop has 8 GB RAM and Windows 11 Home Single Language, and there
is no separate disposable host/client. No VM or OS/hardware purchase is required
now. Preserve the existing scripts/checklist and resume when suitable test
machines are available. These checks are pending, not passed, and still block
commercial Windows release. Independent release/security work can continue.

## Completed engineering checkpoints

- Controlled HTTPS certificate replacement/inspection/recovery now stages and
  retains protected pairs, validates independently approved trust, shares the
  update lock and verifies the exact live certificate before admission. It keeps
  fixed runtime paths and preserves file identity/ACLs. Partial-pair recovery and
  refusal of expired originals are verified locally; see https-operations.md and
  review-coverage.md. Issuer-driven renewal, client trust and real Windows/power-
  loss acceptance remain external release requirements.
  All 248 unit tests, 9 targeted database update/recovery integration tests,
  workspace/test types, production builds, compiled smoke, lint/format checks,
  safe mocked native suites and all 18 PowerShell parser checks passed.

- Publisher issuance now requires an explicit protected local register and its
  expected identity. Recorded predecessors prevent duplicate first issuance and
  stale renewal; atomic no-overwrite sequence commits prevent concurrent forks.
  Exact grant export recovers delivery failures without another signing operation.
  See licensing-operations.md and review-coverage.md for verification and limits.
  All 240 unit tests, both targeted entitlement integration tests, workspace/test
  types, production builds, lint/format checks and compiled smoke passed. Final
  issuer/register reruns passed all 11 focused tests with ephemeral keys only.
  Production custody/deployment and external release dependencies remain pending.

- Supported forward-copy updates now require the target operator's trusted
  migrations, retain the original schema in cutover evidence and restore matching
  application/database/installed state on explicit recovery. Runtime readiness
  distinguishes reviewed retained schemas from current application startup.
  Real PostgreSQL forward/rollback and tampered-history checks, plus orchestration
  fault tests, cover this batch. Local checks passed all 235 unit tests, 64 isolated
  integration tests, workspace/test types, production builds, lint, formatting
  and compiled smoke. Both real update/recovery files passed again after removing
  temporary diagnostics (9 tests). See review-coverage.md for evidence and limits.
  Native Windows acceptance and commercial release dependencies remain pending.

- Connected execution plan is recorded in phase-6-execution.md. Shared protected
  installation state and explicit schema-preserving failed-update recovery now
  verify original signed files, observed OIDs and operator acknowledgements,
  restore the matching pair/state and archive lock evidence after readiness.
  See assisted-updates.md. Initial provisioning/uninstall and actual native
  acceptance remain unfinished; forward-copy recovery is extended above.

- Bound schema-preserving update adapter now connects actual encrypted backup/
  restore, candidate/runtime provisioning and database cutover to implemented
  Windows service/file control. See assisted-updates.md for the narrow supported
  service/startup scope and trusted operator configuration requirements. Isolated
  database cutover is verified with native service calls mocked; real Windows
  service/firewall/task/LAN/reboot acceptance, initial installer, schema-changing
  updates and guided rollback/uninstall remain unfinished or postponed.

- Assisted-update sequencing core verifies real staged packages, requires fresh
  backup/candidate/maintenance/readiness checks from explicit host adapters and
  keeps failures stopped for recovery. Real private file-backed journals/locks
  preserve interrupted operation records. See assisted-updates.md. Windows
  service/database adapter binding, initial installation, rollback/uninstall and
  native acceptance remain unfinished; no runnable installer is claimed.
  This continuation passed all 219 unit tests, API production build,
  application/test TypeScript and lint. Native service/database effects in the
  runner tests are simulated; real signatures and protected filesystem journals
  are exercised. Database/browser/native deployment suites were not repeated.

- Offline maintenance eligibility preflight enforces active maintenance at install
  time for every organization, using signed grants and a read-only full-database
  snapshot. See signed-releases.md. Installer integration and atomic update
  orchestration remain unfinished; this is not permission to install a package.

- Authenticated backup artifacts, host-only backup/key commands and real
  PostgreSQL 18 restore verification. See backup-recovery.md for exact evidence
  and unverified scheduling/native/cutover boundaries.
- Host-only recovery preparation retains a validated database with connections
  disabled, removes copied sessions and audits the candidate without modifying
  the active database. Current-schema checks and generated-target cleanup apply;
  live deployment acceptance remains unfinished. A host-only runtime-permission command
  now applies a reviewed API policy to a dedicated unprivileged role while keeping
  the confirmed candidate quarantined; see runtime-database-access.md.
- A host-only local recovery switch validates the candidate and real runtime
  credentials, preserves the previous database and transactionally swaps database
  names without editing application configuration. Explicit rollback and read-only
  catalog status are available; see recovery-switch.md. Actual customer cutover
  and native service/reboot/LAN acceptance remain unverified.
- Explicit target-confirmed forward migration can upgrade an older supported
  backup in a generated recovery copy, with before/after history/readiness checks
  and source-preserving failure cleanup. db:schema reports the expected trusted
  release-file digest without connecting to a database. Live updates remain gated.
- Signed-file offline activation and provider-neutral SaaS subscription state,
  14-day trials, immediate read-only enforcement, independent RBAC checks,
  perpetual-maintenance behavior, monotonic grant installation and visible
  workspace notices. See licensing-operations.md for remaining issuer/provider
  and commercial deployment work. Publisher-only issuance/renewal tooling now
  verifies encrypted external keys, predecessor grants and monotonic sequences.
  No production issuer keys were created.
- A one-shot Windows backup job with no-overlap locking and success/failure
  reporting, plus signed release-package integrity/version/path preflight and
  publisher-only file inventory/signing with encrypted external keys.
  Reviewable daily/boot task definitions, explicit protected registration and a
  failure/staleness health command are implemented. Actual unattended task/native
  tool/reboot validation, signed installer/update/service cutover and SaaS deployment
  remain release work; see backup-recovery.md and signed-releases.md.
- Protected signed-release staging copies into a new private directory, checks
  Windows NTFS owners/ancestor ACLs and re-verifies bounded copies before success.
  This prepares files without executing them or installing/updating a service.
- Read-only Windows host/client deployment observations check approved executable
  hashes, PoC service identity/listener ownership, HTTPS/API responses and database
  network isolation. Safe decision/secure-XML tests run without machine changes;
  see windows-deployment-checks.md. Actual native/TLS/LAN/reboot evidence and the
  production installer remain deployment gates, not completed acceptance.
- Production dependency audit reported zero advisories for 149 production
  dependencies and is now an explicit CI check. A reproduced mixed-case API
  cache-header gap is fixed, with authenticated-session/error regression coverage.
  This checkpoint is not comprehensive commercial security certification.
- Direct-HTTPS startup validation rejects unusable certificate/key/hostname/date
  configuration before database setup. An hourly monitor reports upcoming expiry
  of the running process's supplied chain without logging certificate/key contents.
  See https-operations.md; automatic renewal and actual Windows trust/LAN/reboot
  acceptance remain unfinished or postponed.
  Configured TLS private keys are also rejected beneath the public frontend root.

Latest application checkpoint: 230 unit tests and all 63 isolated integration tests passed,
with workspace type checks, production builds, compiled runtime smoke, lint,
formatting. Prior Windows task-definition and six-workflow Chrome/Edge
checkpoints remain recorded in review-coverage.md; those tests were not rerun
for these changes. Native PostgreSQL/service/installer/reboot/
unattended scheduling, online issuer/provider integration, remote CI and commercial
release remain unverified or unfinished. The user confirmed no disposable Windows
VM/second client is currently available; signing credentials and SaaS hosting are
also unavailable. This phase remains in progress.

Latest Windows-only continuation passed parsing of all 15 PowerShell files,
mocked deployment observation/contract tests, sanitized CLI rejection, existing
in-memory Task Scheduler checks and repository lint/formatting. Application tests
were not repeated because no application code changed. These local checks do not
constitute native service, trusted LAN/browser, reboot or installer acceptance.
