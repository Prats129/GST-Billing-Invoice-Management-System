# Implementation decisions

Confirmed product architecture remains in PROJECT_CONTEXT.md; this log selects
reversible foundation details without changing those decisions.

- Native ESM throughout, strict TypeScript, pnpm workspace; no framework CLI required.
- NestJS default Express adapter is provisional. REST prefix `/api/v1`.
- Zod validates shared health responses and environment values. No premature DTO system.
- PostgreSQL 18 development target; database not exposed beyond loopback.
- Drizzle migrations run explicitly using a migration credential. Application startup
  never pushes schema. Integration tests create/drop only random dedicated databases.
- Phase 1 starts with organizations; Phase 2 adds identity/authorization schema.
  Phase 3 adds business/customer/catalog master data. Invoice schema remains deferred.
  Billing engine has no calculations yet.
- JSON operational logs omit raw errors, URLs, headers and environment values.
- Loopback development HTTP only; non-loopback bindings require TLS. Host authority
  allowlist is exact including port. Same-origin browser calls need no CORS wildcard.
- Phase 2 security decisions/defaults are recorded in phase-2.md and
  identity-operations.md: explicit delegation, consent-based existing-user
  invitations, protected-owner checks and host-only recovery.
- Phase 3 setup decisions are recorded in phase-3.md: domestic regular registration,
  structural-only GST validation, exact decimal strings, versioned writes, archives,
  immutable classification revisions and explicit operator review. Existing non-owner
  permissions are not silently expanded by an upgrade.

Unresolved: legal calculation/rounding rules, GST/e-invoice scope, exact session/MFA
policies, Windows compatibility matrix, installer redistribution and signing,
certificate renewal UX, commercial backup policy, SaaS provider and pricing.

Version selection and verified environment are recorded in review-coverage.md and
README. Official references: [Node support](https://nodejs.org/en/about/previous-releases),
[Nest migration](https://docs.nestjs.com/migration-guide),
[Vite runtime](https://vite.dev/guide/),
[PostgreSQL support](https://www.postgresql.org/support/versioning/).
CI action major versions follow the current official
[checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node), and
[pnpm setup](https://github.com/pnpm/action-setup) usage.
