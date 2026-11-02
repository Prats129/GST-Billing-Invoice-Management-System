# Recovery database runtime permissions

This host-only Phase 6 command prepares API permissions on an unused recovery
copy. It leaves the copy quarantined (`ALLOW_CONNECTIONS false`). It does not
activate it, change `.env`, install services or change the active database.
Application RBAC, tenant isolation, license enforcement and invoice compliance
checks still apply.

## Prerequisites

Use the trusted release and documented project toolchain. First follow
[backup recovery preparation](backup-recovery.md) and retain its generated
database name and installation UUID. An older backup must be explicitly upgraded
to this release's schema before provisioning permissions.

The private `MIGRATION_DATABASE_URL` must identify the original source database
on loopback. The operator must own the generated candidate and have access to
the maintenance `postgres` database. Candidates must have no connected clients,
no saved sessions and a matching recovery audit marker/schema history. PUBLIC
or other non-owner database access is rejected, except this command's previous
nondelegable CONNECT grant to the chosen role.

A qualified PostgreSQL operator must separately create a dedicated login with
no superuser, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS attributes, no role
memberships and no database/object ownership. For example, in a protected
interactive `psql` operator session:

```sql
CREATE ROLE gst_api_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password gst_api_runtime
```

Use the password prompt, never a password in SQL files, shell arguments, history
or support messages. Protect credentials and PostgreSQL authentication/loopback
configuration separately. This command neither creates accounts nor changes
passwords. Role names must contain only lowercase letters, digits and underscores,
start with a letter/underscore and fit PostgreSQL's 63-byte identifier limit.

## Provision the confirmed copy

Replace placeholders with the actual preparation result; repeat the same name:

```powershell
pnpm recovery:runtime --database <gst_recovery_generated_name> --confirm-database <gst_recovery_generated_name> --installation-id <installation-UUID> --role gst_api_runtime
```

The command accepts only generated `gst_recovery_<32 lowercase hex>` targets and
rejects the configured source database. It takes a per-candidate advisory lock,
temporarily removes the selected role's candidate CONNECT permission, then opens
the copy only for its trusted operator. It validates identity, migration history,
existing effective privileges and absence of sessions before applying grants in
one transaction. It seals the database before committing CONNECT and a
`recovery.runtime_access` audit event. Success reports the candidate, role, schema
digest and `state: quarantined`; it prints no credentials.

## Reviewed permission policy

Grants are explicit for the current release. New tables never inherit automatic
grants. Schema USAGE and database CONNECT are nondelegable; database CREATE/TEMP,
schema CREATE, ownership, role memberships and grant options are rejected.

| Data                                                              | Runtime access                           |
| ----------------------------------------------------------------- | ---------------------------------------- |
| Organizations                                                     | Read/update, including transaction locks |
| Business profiles, registrations, customers, catalog items, users | Read/insert/update                       |
| Catalog tax revisions/reviews                                     | Read/insert                              |
| Memberships, roles, sessions, MFA credentials, auth throttle      | API-required read/insert/update/delete   |
| Role permissions, membership roles, MFA recovery codes            | Read/insert/delete                       |
| Permission definitions                                            | Read                                     |
| Entitlements                                                      | Read; update only `last_observed_at`     |
| Audit events                                                      | Read/insert                              |
| Invoices and invoice series                                       | Read/insert/update                       |
| Invoice snapshots, lines, tax components, cancellations           | Read/insert                              |
| Owner recovery and migration history                              | No access                                |

The API cannot rewrite signed entitlements, delete/rewrite audit events, delete
invoice snapshots or migrate schema with this role. Owner recovery, entitlement
installation and migrations continue to require the separate operator credential.
PostgreSQL's standard system metadata visibility remains; this is not a sandbox
for arbitrary SQL supplied by tenants. API authorization remains essential.

Unsafe pre-existing grants, including column-only or PUBLIC access, fail closed
rather than being silently rewritten. Review the role's purpose and grants with
the operator before retrying. Repeating on an unused candidate is supported;
once it contains runtime login sessions it is rejected. After a failed attempt,
the selected role's candidate CONNECT may remain revoked; table changes roll back
and the command attempts to reseal the candidate. A host/database outage can
interrupt cleanup, so inspect quarantine before any further recovery operation.

## Verification and remaining deployment work

Integration tests use disposable PostgreSQL 18 Docker databases and ephemeral
restricted accounts. They exercise real API login/organization writes, denied
protected SQL, safe unused-candidate retries, rejected privileged/membership/
column/PUBLIC/grant-option access, quarantine and compiled CLI output.

These checks do not validate native Windows PostgreSQL, service startup, reboot,
LAN access, unattended installation or actual disaster cutover. Stop writers,
preserve rollback/configuration keys, review recovered financial history and
explicitly validate application access through the later deployment workflow.
Do not enable a recovery copy for normal use merely because this command passed.

Privilege references: [PostgreSQL privilege checks](https://www.postgresql.org/docs/18/functions-info.html),
[role memberships](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html).
