# Phase 6: commercial hardening

Status: implementation in progress. No commercial release or tax-compliance
approval is implied. Phase 5 issuance gates remain unchanged.

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

Latest application checkpoint: 167 unit tests and all 59 isolated integration tests passed,
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
