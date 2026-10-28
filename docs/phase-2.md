# Phase 2: identity, sessions and tenant authorization

This phase implements the D2/D4/D13 security boundary before business APIs.
No catalog, tax calculation, subscription charging or invoice features are added.

## Acceptance and batches

1. Additive identity/authorization schema with composite tenant foreign keys,
   reviewed migration, append-only audit and serialized protected-owner changes.
2. Argon2id credentials, opaque hashed sessions, idle/absolute expiration,
   rotation/revocation, CSRF/Origin checks and persistent login throttling.
3. Tenant context from active membership; union of multiple role permissions;
   explicit delegation, custom roles, role assignment and owner protections.
4. Privileged SaaS MFA with TOTP and one-time recovery codes, employee password
   reset and host-only offline owner recovery; sensitive actions audited.
5. Login/organization/security/admin UI, OpenAPI, adversarial HTTP/DB tests,
   migration upgrade checks and regression verification.

## Reversible implementation choices

- Use proposed 30-minute idle and 12-hour absolute lifetimes as configurable initial
  defaults, not finalized product policy. No sliding absolute expiration.
- Identity namespaces include edition; an offline credential never authenticates
  a SaaS identity. Organization creation is explicit per owner/customer account.
- Offline first-owner provisioning and owner recovery are host CLI operations,
  never unauthenticated web setup endpoints. Credentials are read from a private
  input file, not process arguments or defaults.
- Use PostgreSQL for sessions/throttle counters; no Redis. Permission and active
  membership checks read the database on every protected request; no stale RBAC cache.
- Owner is an explicit protected membership attribute, not a mutable custom role.
  Owner transitions lock the organization and cannot leave an active org ownerless.
- Delegable permissions are an explicit subset of effective role permissions;
  role-management permission alone never grants delegation. Owners alone manage
  delegation and protected-owner transitions. Owners cannot be disabled/reset by
  ordinary membership administrators.
- Secure HttpOnly SameSite=Strict cookies in deployment. Loopback development
  uses a separately named non-Secure cookie only on loopback HTTP. No localStorage
  credentials. Mutations require exact Origin; authenticated mutations also
  require a session-bound CSRF token sent in a header.
- TOTP secrets require an external 32-byte encryption key. MFA sessions cannot
  access organization data until verified when privileged or MFA-enabled.
- RLS evaluated: deferred until request-scoped transaction context can be proven
  for every query; tenant-safe FK constraints and explicit authorization are
  mandatory now. Database owner/DDL credentials must never serve production APIs.

References: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[node-argon2](https://github.com/ranisalt/node-argon2),
[OTPAuth](https://github.com/hectorm/otpauth).

## Local acceptance (2026-10-28)

Phase 2 implementation and local acceptance are complete. Verified with Node24,
pnpm10 and PostgreSQL18.6: strict types/lint/build, 20 unit tests, 18 isolated
DB/HTTP tests, and two end-to-end workflows in both Chrome and Edge. Tests cover
tenant/edition isolation, explicit delegation, owner concurrency, session/CSRF
boundaries, forced password change, consent-safe resets, MFA/recovery, host CLI
file preservation and append-only audit. The local Phase 1 database upgraded
successfully; repeat migration and schema drift checks passed. Phase 1 migration
history is unchanged. Detailed commands/results are in review-coverage.md.

Remote CI, native Windows service/LAN HTTPS/firewall/reboot validation and the SaaS
all-factors-lost platform recovery procedure remain deployment/release gates.
Browser checks use loopback HTTP; they do not validate those deployment behaviors.
The configured session/rate defaults remain initial operational choices, not final
commercial policy. Billing features remain outside this phase.
