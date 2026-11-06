# Implementation decisions

2026-11-05 ordinary invoice release: the project owner confirms CA review and
approval of calculations, rounding, invoice fields and numbering. Record this as
owner-confirmed approval, without inventing a reviewer identity or independently
verified report. Enable only supported ordinary domestic invoices assessed as not
requiring e-invoicing. IRP integration is postponed; unknown/required applicability,
issued credit/debit notes and issued cancellation remain blocked. This supersedes
the blanket pending-approval statements in earlier dated implementation records.

Phase 6 user decision (2026-11-02): offline updates require active maintenance at
installation time, rather than eligibility based on release publication date.
Every organization sharing the offline installation must qualify. Optional
maintenance expiry continues to leave perpetual billing rights intact.

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

Unresolved: e-invoice integration and correction/cancellation release scope, exact session/MFA
policies, Windows compatibility matrix, installer redistribution and signing,
certificate renewal UX, commercial backup policy, SaaS provider and pricing.

User decision: postpone actual Windows VM/install/service/reboot/LAN acceptance.
The available laptop has 8 GB RAM and Windows 11 Home Single Language; no spare
test host or separate client is available. A Windows guest would leave limited
memory for the host/development tools, so no VM, RAM/OS purchase or privileged
deployment changes are required now. The tests remain unverified release gates,
not waived or marked complete. Resume on suitable disposable hardware with a
separate Windows client. Continue independent Phase 6 release/security work.

Phase 6 user decision (2026-10-30): trial and time-limited subscription expiry
immediately makes business data read-only; no grace period. Optional maintenance
expiry never terminates a perpetual offline license. No Windows code-signing
certificate or SaaS provider is currently available. Signed grants use external
Ed25519 issuer keys, independently of Windows Authenticode certificates. Key trust
and grant installation are host/platform-operator duties, not tenant RBAC powers.

Phase 6 runtime baseline is Node 24.22.1+ within major 24 and pnpm 10.34.9,
enforced by workspace engines. This matches .nvmrc and signed release manifests
and prevents the observed Node 22.13.0 Windows Argon2 crash from being reached by
a normal pnpm install/dev command. Existing system-wide tools are not replaced.

Version selection and verified environment are recorded in review-coverage.md and
README. Official references: [Node support](https://nodejs.org/en/about/previous-releases),
[Nest migration](https://docs.nestjs.com/migration-guide),
[Vite runtime](https://vite.dev/guide/),
[PostgreSQL support](https://www.postgresql.org/support/versioning/).
CI action major versions follow the current official
[checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node), and
[pnpm setup](https://github.com/pnpm/action-setup) usage.

## Platform Admin scope (2026-11-05)

User-approved: one private platform owner with mandatory MFA; separate admin UI/API
and database in this monorepo; online and offline directory; online onboarding and
verified SaaS grant application; manual agreements, partial receipts, adjustments
and balances; exact negotiated prices/dates; externally signed grants; reasoned
SaaS write pause preserving reads/printing. Organization ownership is never
platform authority. Publisher keys stay in encrypted offline custody, which is
not yet prepared. No gateway, invoice-payment tracking, staff access, impersonation,
feature-flag system, offline remote management or synchronization is introduced.
Production hosting/signing and postponed native Windows acceptance remain separate.
