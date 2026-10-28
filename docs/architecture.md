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
reviewed migrations and connection helpers. Billing-engine contains only a version
boundary; no financial calculation or legal compliance is claimed. Renderer and
other feature packages are deferred until useful.

Offline: dedicated Windows host, loopback PostgreSQL, Node Windows service, browser
LAN clients over HTTPS with explicitly trusted private CA. SaaS: same code/schema,
separate identities and deployment configuration. No V1 cloud synchronization.

Identity/authorization services live in apps/api/src/security. Controllers validate
shared contracts and enforce cookie/CSRF/Origin boundaries. Permission changes and
audits commit together; protected access reads current grants without a stale cache.
The React workspace offers login/MFA/security and permission-gated administration.
Provisioning/recovery is host CLI only. See phase-2.md and identity-operations.md.
Customer billing remains unavailable.
