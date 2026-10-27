# Architecture

Phase 1 implements a pnpm modular monolith: React/Vite browser client, NestJS REST API,
Drizzle/PostgreSQL persistence, and runtime-validated shared health contracts. Both
editions share these modules. Express is provisional, not a permanent adapter choice.

The web client uses same-origin `/api/v1` requests (Vite proxies locally; the offline
host serves built assets). Liveness never depends on PostgreSQL; readiness checks
connectivity and the foundation migration. Database errors and configuration secrets
never enter public responses or structured logs. Database connections are pooled,
bounded, and closed on shutdown. No migration runs during application startup.

The initial business schema contains organizations only, with UUID identity and
explicit status constraints. No tenant data API exists yet. Users, memberships,
tenant-safe composite foreign keys, RBAC and owner invariants belong to Phase 2;
every future tenant-owned record must carry organization_id. PostgreSQL RLS will
be evaluated as defense in depth, never as the only authorization boundary.

Contracts contain runtime validation and transport types. Database owns schema,
reviewed migrations and connection helpers. Billing-engine contains only a version
boundary; no financial calculation or legal compliance is claimed. Renderer and
other feature packages are deferred until useful.

Offline: dedicated Windows host, loopback PostgreSQL, Node Windows service, browser
LAN clients over HTTPS with explicitly trusted private CA. SaaS: same code/schema,
separate identities and deployment configuration. No V1 cloud synchronization.

The foundation exposes only health and OpenAPI; it has no authentication or customer
operations. Do not deploy it for customer billing. Authentication, secure opaque
sessions, CSRF, MFA and authorization must precede sensitive APIs.
