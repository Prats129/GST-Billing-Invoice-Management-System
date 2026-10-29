# Requirements and scope

The source of truth is PROJECT_CONTEXT.md decisions D1–D15. Phase 1 delivers
workspace tooling, strict TypeScript, environment validation, REST/OpenAPI health,
browser connectivity, PostgreSQL/Drizzle migration, isolated integration tests,
CI, development instructions and an explicitly experimental Windows deployment spike.

Confirmed V1 decisions: two editions with one business schema; one organization per
subscription and multiple organizations per user; dynamic tenant RBAC with protected
owner; decimal-safe GST; immutable invoices with transactional numbers and snapshots;
HTML browser printing; secure backup/recovery; signed offline licensing/updates;
native Windows host and HTTPS LAN; opaque server sessions; 14-day trial.

Later implementation must enforce tenant composite FKs, owner and delegation rules,
idempotency, optimistic concurrency, audit immutability, supported GST scenario gates
and e-invoicing eligibility. Official legal review is required before real issuance.

Excluded from Phase 1: billing UI, GST arithmetic, auth, licenses, MFA, subscriptions,
financial tables and printing. V1 also defers payments, inventory, rentals, sync,
built-in PDF/DOCX, return filing and broad integrations except legal necessities.

Acceptance: documented local startup; browser health connection; API database
readiness; reproducible checked-in migration; build/lint/typecheck/tests; explicit
blockers with evidence; no secrets/public DB exposure; current review coverage.

Phase 2 adds the identity, MFA, session and tenant authorization requirements in
phase-2.md. Admin UI includes roles/delegation, assignments and effective permissions.
First-owner setup/recovery is host-only; no default account. Existing-user joins
require explicit acceptance. Financial features and subscription charging stay deferred.

Phase 3 adds the business/registration, customer and catalog requirements in phase-3.md.
GSTIN/state/HSN syntax checks and operator review do not certify tax treatment or
e-invoice eligibility. Catalog values remain decimal strings; archive/version/audit
and tenant authorization boundaries apply to every master-data mutation.

Phase 4 adds the pure calculation requirements in phase-4.md: exact quantities,
inclusive/exclusive rates, line/invoice discounts, deterministic residual allocation,
guided jurisdiction, reviewed effective classifications and reconciled tax totals.
Unsupported transactions/versions and unauthorized overrides fail explicitly.
Calculation previews do not authorize invoice issuance or certify current law.

Phase 5 adds tenant-scoped invoice drafts, server-derived calculations, optimistic
versioning and idempotent create/finalize requests, transactional numbering,
immutable normalized financial rows and checksummed rendering snapshots, linked
full credit reversals and A4 browser printing. Existing grants stay unchanged.
Sensitive SaaS billing access requires MFA. Draft printouts must be unmistakable;
no client/API/environment switch can bypass professional issuance gates. Value-based
partial credits/debits use original tax details and enforce cumulative balances;
correction drafts are versioned. Cancellations are append-only and separately
authorized. PNG logos are bounded and included in immutable print data. Tax-only,
rate-changing or externally reported/IRP corrections require a reviewed wider scope.
