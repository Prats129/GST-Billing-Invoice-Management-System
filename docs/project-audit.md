# Project-wide audit and refactoring — 2026-11-07

Status: audit/refactoring pass completed and locally verified. This document
records reviewed scope, verified findings, incremental changes and verification;
it is not a production release sign-off.

## Scope and method

Audit all tracked applications, shared packages, migrations, scripts, test and
deployment configuration. Trace imports, package exports, command entry points,
PowerShell invocation and test dependencies before removing code. Generated
migration snapshots and historical SQL are compatibility artifacts, not dead
code. Keep security domains, public contracts, financial rules and release gates.

Use static inventory/unused-symbol diagnostics plus manual review of each
subsystem's risk-bearing paths. Verify changes against disposable databases and
ephemeral credentials. Never reset live data or modify the laptop's services,
firewall, trust store or signing configuration for this audit.

## Coverage

| Area                                          | Review status             | Particular checks                                             |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| Workspace, dependencies, CI and configuration | Reviewed                  | Import ownership, entry points, pinned tools and checks       |
| Customer identity, tenancy and permissions    | Reviewed                  | MFA/session/recovery, CSRF, locks, role boundaries            |
| Platform admin and cross-database operations  | Reviewed                  | Separate auth/storage, receipts, leases, retry safety         |
| Business data and invoicing                   | Reviewed                  | Tenant scoping, concurrency, immutable history, query bounds  |
| Contracts, billing engine and renderer        | Reviewed                  | Validation, exact money, rounding/provenance, escaping        |
| Licensing and publisher tooling               | Reviewed                  | Signature/binding/sequence checks, key/history protection     |
| Database migrations, backup and recovery      | Reviewed                  | Constraints, restricted roles, restore quarantine and cutover |
| Windows installer/update/certificates         | Reviewed source/contracts | Path safety, stop/recovery states, script invocation graph    |
| Billing/admin frontends and shared UI         | Reviewed                  | Dead state, request races, unsaved work, duplication          |

## Findings and decisions

Findings are recorded only after confirming the relevant call paths and impact.
Public exports, recovery branches and deployment entry points are not removed
solely because static import counts are zero.

| ID     | Finding                                                                                                                               | Resolution / verification                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-01 | Customer API still declared Argon2 directly after crypto moved to @gst/security; OTPAuth was imported only by its tests               | Remove redundant direct Argon2 declaration and move OTPAuth to devDependencies. Shared security retains both production dependencies; packaging graph was traced.                               |
| AUD-02 | Password-work capacity guard used a throw-only IIFE                                                                                   | Replace with direct throw; add a concurrency-limit/released-capacity regression.                                                                                                                |
| AUD-03 | No enforced unused-symbol compiler checks despite a clean diagnostic baseline                                                         | Enable noUnusedLocals/noUnusedParameters for source and tests. Preserve public exports and command-only code.                                                                                   |
| AUD-04 | Platform password change checked recent proof before hashing, then committed without rechecking live session authority                | Add a transaction-local owner/session guard shared with platform mutations and session revocation. Test stale freshness and revocation without changing the password or executing the mutation. |
| AUD-05 | Draft discard parsed trimmed cancellation input outside error handling, so whitespace-only reasons threw an uncaught validation error | Use safeParse and the existing field-message popup. Extend the browser workflow to check repeated invalid submissions, no mutation request and successful correction.                           |

AUD-06: finalization inserted normalized lines and tax components separately per
line while holding the organization lock. Batch each table in one statement and
use ID maps for association. Preserve the snapshot transaction, FK/financial
guards and numbering. Add a real 100-line persistence/retry regression.

AUD-07: legacy dashboard cards, old sidebar/account markup and former toolbar
selectors remained after the workspace redesign. Remove approximately 600 lines
of unreachable CSS after checking all tracked source, generated class patterns
and comma-group selectors. Keep live shared selectors and dynamically generated
accent swatches. Desktop/mobile browser checks validate the retained UI.

Static inventory covers 353 tracked files (333 under the scoped application,
package, script, test and documentation directories). AST dependency ownership
found three customer API candidates: Argon2 and OTPAuth are handled above; RxJS
is retained because Nest requires it at runtime, despite no direct import there.
Strict unused-symbol checks passed across all workspace projects and tests before
enforcement. The production registry advisory report contained zero known
advisories across 153 production dependencies; this is a point-in-time registry
check, not a proof of application security.

### Retained deliberately

- Billing uses bounded exact-integer arithmetic and versioned rules. Calculation
  already loads catalog/history in batches; no speculative cache was added.
- Tenant and platform authentication remain separate. Platform operations retain
  durable receipts, bounded retries and explicit reconciliation after restore;
  financial records retain agreement locks and idempotency checks.
- Public exports, host CLI commands, migrations/snapshots, error recovery paths
  and publisher signing/register history are retained. Different canonical
  serializers protect different persisted formats and are not interchangeable.
- Print template a4.v1 and gated correction/cancellation paths remain historical
  compatibility/release concerns. This audit does not unlock unsupported issuance.
- Customer packaging follows the production dependency graph; shared security
  still supplies Argon2/OTPAuth. Administrative and publisher applications and
  credentials remain outside customer distributions.

Coverage combines tracked-file inventory, project-wide import/unused/risk-pattern
analysis, manual review of the listed security/business/operational boundaries
and regression tests. It does not mean every line received a separate formal
proof, penetration test or production-scale performance benchmark.

## Verification and limits

Baseline worktree was clean. Final verification:

- Repository formatting, lint, all workspace/test TypeScript checks and all four
  application production builds passed.
- All 290 unit tests passed. An earlier run hit the schema CLI subprocess timeout
  during concurrent build work; the complete isolated rerun passed without
  relaxing any timeout or production check.
- All 87 integration tests passed: 86 in the full suite plus the separately
  enabled fresh-cluster installer database test. Backup/restore, quarantine,
  licensing, financial concurrency, rollback and the new 100-line persistence/
  retry regression ran against disposable databases and ephemeral credentials.
- All 18 Chrome browser tests passed using fresh builds. Coverage includes both
  applications, desktop/mobile layout, themes, access controls, unsaved work,
  detail navigation, notifications, invoice calculation/printing and repeated
  invalid draft-discard reasons followed by a valid discard.
- All four safe Windows CI scripts passed: syntax parsing of 27 PowerShell files,
  task-definition/native-parser checks and mocked deployment/update contracts.
  These did not install services, register tasks or change firewall/trust state.
- CSS AST comparison confirmed unchanged declarations/cascade order for all 544
  retained selectors; 126 unreachable selectors were removed. The production
  web CSS bundle decreased from 60.67 kB to 50.92 kB (11.70 to 10.15 kB gzip).
- An isolated portable customer runtime assembled 145 packages/6,549 entries.
  A module-resolution guard prohibited repository fallback while packaged
  Argon2 hashing/verification and OTPAuth generation succeeded. The probe found
  no admin application or signing/private configuration content. This is a
  dependency/packaging probe, not a signed Windows installation acceptance test.

No live data was reset, no historical migrations or persisted signing/financial
formats changed, and no external package versions were upgraded. The user's
staged snapshot was preserved when resuming; final verification notes were
updated separately in the working tree. There are no unfinished code edits from
the interruption within this audit's identified changes.

External release requirements remain in [phase-6-release-gaps.md](phase-6-release-gaps.md):
production hosting/signing/custody and postponed disposable Windows host/client
acceptance cannot be established by a local source audit.
