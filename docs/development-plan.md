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

Phase 2 priorities: identity/session threat model and implementation, tenant
memberships, default-deny RBAC, restricted delegation and owner concurrency
invariants; adversarial tenant tests before any business data endpoints.

Later: business profile/catalog; legally reviewed decimal GST engine; transactional
invoice lifecycle/renderer/corrections; commercial deployment and recovery hardening.
