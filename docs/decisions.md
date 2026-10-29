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
  Phase 4 implements the pure calculation preview; invoice issuance remains deferred.
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
- Phase 4 uses exact scaled BigInt quotients, half-up paise rounding and stable
  largest-remainder allocation. Invoice discounts use eligible tax-exclusive values;
  component totals reconcile by rate/category group. This is an explicitly versioned
  engineering policy requiring professional tax approval before commercial issuance.
- The engine consumes trusted master-data/permission snapshots; it does not authenticate
  those snapshots. No HTTP calculation endpoint or invoice schema is added in Phase 4.
  Supported scenarios, official-source review and preview boundaries are in phase-4.md.
- Phase 5 invoice drafts are bounded to 100 lines and use existing organization
  serialization, optimistic versions and UUID request keys. Finalization uses a
  reviewed-preview checksum, locked per-registration/FY/document counter and atomic
  normalized financial rows plus a checksummed immutable snapshot. INV/CN numbers
  use six-digit counters and stay within 16 characters. See phase-5.md.
- The a4.v1 renderer escapes text and prints saved data in a script-free iframe,
  with an external versioned stylesheet and prominent warnings for drafts. No PDF
  service, remote assets or uploaded executable content is introduced.
- Issuance remains blocked by the existing pending tax policy, independently of
  RBAC and e-invoice settings. Full credit reversal preserves original amounts;
  partial credits and debits follow versioned original-value adjustment rules.
  Cancellation is an append-only record under a separate `invoices.cancel` grant;
  reported/IRP cancellation and tax-only/rate-changing notes remain unsupported.
  Bounded PNG logos are normalized by the browser and frozen into print snapshots.
  Billing read/write/override permissions require privileged SaaS MFA; upgrades
  insert permission definitions without silently expanding non-owner grants.

Unresolved: professional approval of calculation/rounding and commercial GST/e-invoice scope, exact session/MFA
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
