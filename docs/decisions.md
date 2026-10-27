# Implementation decisions

Confirmed product architecture remains in PROJECT_CONTEXT.md; this log selects
reversible foundation details without changing those decisions.

- Native ESM throughout, strict TypeScript, pnpm workspace; no framework CLI required.
- NestJS default Express adapter is provisional. REST prefix `/api/v1`.
- Zod validates shared health responses and environment values. No premature DTO system.
- PostgreSQL 18 development target; database not exposed beyond loopback.
- Drizzle migrations run explicitly using a migration credential. Application startup
  never pushes schema. Integration tests create/drop only random dedicated databases.
- Organizations is the only initial business entity; speculative financial/auth schema
  is deferred. Billing engine is a version-only boundary, not a calculation engine.
- JSON operational logs omit raw errors, URLs, headers and environment values.
- Loopback development HTTP only; non-loopback bindings require TLS. Host authority
  allowlist is exact including port. Same-origin browser calls need no CORS wildcard.

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
