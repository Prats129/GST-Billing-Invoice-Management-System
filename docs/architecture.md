# Architecture

The application is a pnpm modular monolith: React/Vite browser client, NestJS REST API,
Drizzle/PostgreSQL persistence, and runtime-validated shared health contracts. Both
editions share these modules. Express is provisional, not a permanent adapter choice.

The web client uses same-origin `/api/v1` requests (Vite proxies locally; the offline
host serves built assets). Liveness never depends on PostgreSQL; readiness checks
connectivity, identity tables and the reviewed owner-guard migration. Database errors and configuration secrets
never enter public responses or structured logs. Database connections are pooled,
bounded, and closed on shutdown. No migration runs during application startup.

Phase 2 adds edition-separated users/memberships/sessions, tenant roles,
permission/delegation grants, encrypted TOTP secrets, one-time recovery proofs,
throttles and append-only audit. Composite FKs reject cross-tenant/edition links.
Organization locks serialize authorization/ownership mutations; deferred checks
enforce active owners. Every future tenant row must carry organization_id. RLS
was evaluated and deferred until safe request-scoped context is designed; it will
be defense in depth, never the only authorization boundary.

Contracts contain runtime validation and transport types. Database owns schema,
reviewed migrations and connection helpers. Billing-engine is a pure synchronous
calculation preview package using exact BigInt scaled units, validated decimal
strings, dated reviewed classifications and guided jurisdiction facts. It has no
database/HTTP/clock dependency. Financial rules/rounding are versioned; every result
includes provenance and reconciled lines/rate groups/totals. The package reuses
contracts validation and adds no external financial dependencies. The Phase 5
invoice-renderer package owns escaped versioned HTML, with its immutable A4 CSS
served as a public static asset. Professional tax approval and issuance
gates remain separate from calculating a preview.

Offline: dedicated Windows host, loopback PostgreSQL, Node Windows service, browser
LAN clients over HTTPS with explicitly trusted private CA. SaaS: same code/schema,
separate identities and deployment configuration. No V1 cloud synchronization.

Identity/authorization services live in apps/api/src/security. Controllers validate
shared contracts and enforce cookie/CSRF/Origin boundaries. Permission changes and
audits commit together; protected access reads current grants without a stale cache.
The React workspace offers login/MFA/security and permission-gated administration.
Provisioning/recovery is host CLI only. See phase-2.md and identity-operations.md.
Business master data lives in apps/api/src/business. Reads enforce current tenant
permissions; writes share the organization lock and atomic audit transaction.
Master-data versions reject stale saves. Catalog price/rate transport uses decimal
strings, with PostgreSQL NUMERIC storage; catalog reads use repeatable-read snapshots.
Tax classification revisions/reviews are immutable and tenant-linked. Semantic
item/classification changes create new unreviewed revisions. Browser business
screens validate shared contracts and use bounded server search/pagination.
Invoicing lives in apps/api/src/invoicing. Every draft calculation derives context,
prices, history and override authority server-side under the organization lock.
Finalization rechecks a reviewed digest and release gates, then commits locked series
allocation, normalized lines/components, immutable checksummed snapshot and audit.
Drafts use version checks; create/finalize retries use scoped request keys. Financial
rows reject later changes and deferred DB guards require snapshot reconciliation.
Historical printing uses saved rendering data, never current customer/catalog rows.
The workspace supports drafts, calculations, editable original-value credit/debit
adjustments, append-only cancellations and A4 previews with saved PNG logos.
Correction snapshots identify their original/prior-note digests; finalization
rechecks cumulative balances, with deferred DB guards as defense in depth.
Cancellation is separately authorized and never mutates an issued snapshot/number.
Commercial issuance and unsupported correction cases remain gated as documented
in phase-5.md.
