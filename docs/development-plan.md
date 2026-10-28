# Development plan

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

Later: legally reviewed decimal GST engine; transactional
invoice lifecycle/renderer/corrections; commercial deployment and recovery hardening.
