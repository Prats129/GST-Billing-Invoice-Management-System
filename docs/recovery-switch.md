# Controlled local recovery switch

This host/platform-operator command completes the database switching step after
[recovery preparation](backup-recovery.md) and
[runtime permission provisioning](runtime-database-access.md). It operates on the
same loopback PostgreSQL 18 instance. It is not a Windows service manager or a
remote managed-SaaS restore tool.

No new connection-file format is introduced. The recovered database takes the
existing active database's name; the previous database is retained as
`gst_previous_<recovery suffix>` with connections disabled. PostgreSQL commits the
two renames and connection flags together. Existing application URLs, passwords,
MFA configuration, ownership and database contents are not rewritten. This does
not merge records written since the backup.

## Before activation

1. Preserve the original installation, approved release/configuration and backup.
   Review the backup's recovery point, recovered financial/identity records and
   missing transactions with the owner. Recover the correct application/MFA keys
   and review entitlement/recovery authority. Do not substitute a new encryption
   key for the original key.
2. Prepare/upgrade the separate recovery copy and provision its dedicated runtime
   role. Keep the candidate quarantined. Use the trusted release matching its
   schema and the original installation UUID.
3. Stop the API service or development process, background writers, backup jobs
   and database inspection clients. Disable automatic restart during maintenance.
   The command refuses connected clients and prepared transactions; it never
   terminates sessions or stops services itself.
4. Use protected operator configuration. `MIGRATION_DATABASE_URL` identifies the
   original active database; its role must own both databases and have CREATEDB
   authority. `DATABASE_URL` identifies that same database/host/port using the
   dedicated unprivileged API role. Keep both credentials out of arguments/logs.
   The command reads the private root `.env`, or the `ENV_FILE` selected by the
   operator. It does not change either file or any Windows service configuration.

Active names are restricted to lowercase PostgreSQL identifiers, excluding
maintenance/template databases and generated recovery/previous names. Candidate
names must be the exact `gst_recovery_<32 lowercase hex>` returned by preparation.
An existing rollback destination is rejected. The database owner is a trusted
host operator, not a tenant administrator.

## Inspect, activate and validate

Select the project toolchain and substitute actual values:

```powershell
pnpm recovery:switch status --recovery-database <generated-recovery-name> --confirm-active-database <existing-active-name> --installation-id <installation-UUID>
pnpm recovery:switch activate --recovery-database <generated-recovery-name> --confirm-active-database <existing-active-name> --installation-id <installation-UUID> --confirm-writers-stopped
```

`status` only reads the database catalog and reports names, OIDs, connection flags
and operator ownership. It does not validate business records or certify recovery
identity. Save the preparation/switch output in the protected recovery record.

Activation requires matching preparation/runtime-access audit metadata, current
migration history, reviewed effective runtime privileges, no copied sessions and
owner-only/dedicated-role database access. It holds the same per-database advisory
locks used by runtime provisioning. Operator validation temporarily revokes the
candidate role's CONNECT permission while inspecting the otherwise sealed copy.
It then briefly opens the candidate for a real API-runtime authentication and
database-readiness probe, closes that pool and reseals it. Other application
processes must remain stopped throughout this maintenance window.

A `recovery.cutover_prepared` audit event binds installation, target and original
schemas, role, names
and the original/recovered database OIDs. This event records preparation, not
proof of activation. The maintenance transaction then moves the original aside,
promotes the recovery copy and enables only the active name. Built-in rename
locks also reject clients that race the earlier idle check. No database is dropped.

Success returns `state: activated`, the names and active/retained OIDs. Restart the
API with the same reviewed configuration, check `/api/v1/health/ready`, sign in
again, and verify recovered history and print access before admitting users.
Invoice compliance gates and license/RBAC checks remain in force. Native service,
TLS/LAN and deployment acceptance still require their own environment tests.

## Explicit rollback

Stop all writers/restart policies again and review changes made after activation.
Rollback returns to the preserved previous database's contents. It does not merge
new invoices, memberships, license installations or other recovered-copy changes;
those changes remain only in the retired recovery database. Obtain the owner's
recovery-point decision before running:

```powershell
pnpm recovery:switch rollback --recovery-database <same-generated-recovery-name> --confirm-active-database <same-active-name> --installation-id <same-installation-UUID> --confirm-writers-stopped --confirm-rollback-data-loss
```

Rollback checks the prepared record's installation, schema, role and both OIDs.
It refuses a substitute previous database, connected clients or missing explicit
acknowledgement. It also briefly probes the previous database with the runtime
credential and requires reviewed retained-release readiness before changing names.
The retained migration history must match the schema recorded at activation; a
known name/OID alone is insufficient. Supported Phase 5/6 structural probes allow
returning to the original release after a forward-copy migration without running
a down migration. Current application startup still requires its current schema.
Older schema-preserving receipts without an original-schema field are accepted
only for the matching current schema. The recovered
copy moves back to its original generated name
with connections disabled; the previous database regains the active name. Its
original grants/data remain intact. A `recovery.rollback_prepared` event remains
in the retired recovered copy. Restart and validate the original application
again. Neither action automatically starts the API or deletes retained databases.
Track retained copies/storage manually under the approved retention policy.

## Failures and evidence

Validation failures keep the original database at its active name and attempt to
reseal the candidate. If validation failed after temporary CONNECT revocation,
the candidate role may need the existing runtime-provisioning command reapplied
before retrying. Preparation audit events can remain even when no switch happened.
Errors during the rename transaction roll back its names/flags together.

After a server/host outage or lost COMMIT acknowledgement, keep the API stopped,
inspect `status`, compare OIDs with the recovery record and inspect PostgreSQL
health before retrying. A client-side failure cannot prove whether COMMIT reached
the server. Never blindly reverse a switch, delete an apparently old database or
use an audit event alone as proof of which database is active. A crash during a
temporary validation window may require explicit operator resealing.

Disposable PostgreSQL 18 Docker tests with a non-superuser owning operator and
separate restricted API login cover real API login after activation,
original/recovered OID and data preservation, unchanged runtime URL, explicit
rollback, blocked clients/operator locks, invalid identity/grants/passwords,
transaction failure and compiled CLI output. These are local engineering checks;
native Windows PostgreSQL/service/reboot/LAN, power-loss recovery and actual
customer cutover remain unverified. No live switch is performed during development.

References: [PostgreSQL ALTER DATABASE permissions and connection controls](https://www.postgresql.org/docs/18/sql-alterdatabase.html),
[PostgreSQL rename locking and catalog updates](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/commands/dbcommands.c).
