# Development plan

Release update (2026-11-05): the owner confirmed CA approval and ordinary domestic
invoice issuance is released within the existing supported scope. E-invoice
integration is postponed; unknown/required applicability, issued credit/debit notes
and issued cancellation stay blocked. See phase-5.md for the superseding release
record; earlier phase acceptance statements below describe the original gate state.

1. Repository audit and architecture requirements checkpoint.
2. Workspace, API/contracts, React connectivity shell and config tests.
3. PostgreSQL schema/migration, isolated DB integration and CI.
4. Windows service/PostgreSQL/HTTPS feasibility spike alongside foundation work.
5. Run installation, build, lint, types, tests, migration and runtime smoke checks;
   fix issues and record precise limitations.

Phase 1 implementation and local acceptance checks are complete. See the final
acceptance checkpoint in review-coverage.md for commands, results, retained local
development services and outstanding Windows deployment/remote CI validation.

Phase 2 implementation covers identity/session threat boundaries, MFA, consent-based
memberships, default-deny RBAC, explicit delegation and owner concurrency invariants.
Phase 2 local acceptance is complete; see phase-2.md and review-coverage.md for
commands/results and outstanding deployment/release validation.

Phase 3 implementation and local acceptance are complete: business/GST profile,
customer and product/service master data, archives, versioned classification review
and responsive workspace screens.
Acceptance and evidence are in phase-3.md and review-coverage.md.

Phase 4 engineering implementation and local acceptance are complete: the pure exact
GST preview engine, source-reviewed scope and discount/rounding specification, with
arithmetic/authority/jurisdiction/property tests. Evidence and pending professional
tax approval gates are in phase-4.md and review-coverage.md.

Later: transactional invoice lifecycle/renderer/corrections; commercial deployment,
professional compliance approval and recovery hardening.

Phase 5 engineering includes invoice builder and persisted drafts, server calculation,
reviewed-preview finalization machinery, immutable snapshots, full credit reversal
and versioned A4 printing, editable partial credit/debit value adjustments, immutable
cancellation records and PNG logos. See phase-5.md and review-coverage.md for evidence
and exact scope. Commercial issuance remains blocked by professional compliance
approval; production deployment and commercial hardening remain Phase 6/release work.

Phase 6 is in progress. Start with authenticated encrypted backups and disposable
restore verification; then licensing, signed installation/update, subscriptions
and deployment/release checks. See phase-6.md and backup-recovery.md. No provider,
signing certificate or commercial retention policy is silently selected. The user
confirmed immediate read-only at trial/subscription expiry, with no grace period.
