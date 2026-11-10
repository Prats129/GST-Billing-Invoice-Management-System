# Host-operated encrypted backup and restore verification

For reusable protected profiles, fixed host actions and Admin status publication,
see [guided backup and recovery](guided-backup-recovery.md). The lower-level
commands below remain supported. Customer artifact format/compatibility checks
are preserved; platform backups use a separate schema adapter and domain.

Phase 6 implementation. These are host/platform-operator commands, not tenant
endpoints. Full shared SaaS restoration is never delegated to organization admins.
Commercial scheduling/retention and managed-provider backups still need deployment
validation. No live database cutover is implemented by the verification command.

## Format and boundaries

The source is PostgreSQL 18 on loopback. Use approved PostgreSQL 18 tools or the
explicit local development PostgreSQL container. The operator credential in the
private `.env` `MIGRATION_DATABASE_URL` needs backup access and CREATE DATABASE for
drills. It must never be the API runtime credential in a commercial installation.

The tool runs `pg_dump --format=custom` against an exported repeatable-read
snapshot. Row counts are collected from the same snapshot. It validates the
archive listing, then streams AES-256-GCM encryption with a random 96-bit nonce.
An authenticated versioned manifest binds installation UUID, migration digest,
PostgreSQL major, timestamp, archive size, SHA-256 and table counts. The manifest
is readable metadata; it contains no passwords, customer names or business rows.
Artifacts and decrypted outputs never overwrite existing paths. Atomic hard-link
publication requires a local filesystem supporting hard links (NTFS/ext4); export
the completed encrypted file to external media afterward.

Temporary plaintext is written only inside a new protected workspace. Windows
applies a private NTFS ACL first; POSIX uses mode 0700/0600. Failures stop and clean
up the generated workspace; source data is never deleted. A process/power crash
can leave a private workspace requiring operator inspection and cleanup. Ordinary
file deletion is not a secure erase guarantee; use encrypted disks for plaintext
workspaces and recovery keys. Disk encryption/key escrow are deployment duties.

The database's recorded migration hashes must match a known Phase 5-or-later
prefix of this release. This allows a pre-upgrade backup before applying a new
migration. Restore verifies the authenticated prefix and does not upgrade it.
Unknown/newer histories are rejected; use their matching release. The artifact
is not a cross-version migration or live cutover tool.
Only restore backups from a trusted installation: PostgreSQL archives can execute
database functions/DDL. Encryption authenticates the holder of the backup key,
not arbitrary third-party dump contents.

## One-time Windows key setup

Select the documented Node 24/pnpm 10 toolchain first. In a private location,
create a new key directory (do not reuse an existing directory):

```powershell
.\apps\windows-installer\scripts\New-BackupKey.ps1 -Directory 'E:\GST-private-backup-key'
```

Keep `backup.key` and `installation-id.txt` together in restricted host storage;
keep a protected off-device recovery copy **separate from the backup archives**.
Never send these files in support messages. Losing the key makes backups
unrecoverable; generating a replacement cannot decrypt existing archives. Do not
reuse `AUTH_DATA_KEY` as a backup key. That separate MFA encryption key is not in a
database dump and needs its own protected configuration recovery copy.

On POSIX, create a private 0700 directory, then use `pnpm backup keygen --key-file
/private/backup.key`; retain the returned non-secret installation UUID. Existing
keys are never replaced. On Windows the Node keygen command refuses to write a
key because POSIX mode bits cannot enforce NTFS permissions.

## Backup and restore drill

Build packages first if running compiled tools. Development uses the host-only
TypeScript command and loads the private root `.env`. Example with the current
development container (substitute your actual protected paths):

```powershell
$installationId = (Get-Content -Raw 'E:\GST-private-backup-key\installation-id.txt').Trim()
pnpm backup create --key-file 'E:\GST-private-backup-key\backup.key' --installation-id $installationId --work-directory 'E:\GST-private-work' --artifact 'E:\GST-backups\manual-001.gstbackup' --docker-container gst-billing-invoice-management-system-postgres-1
pnpm backup verify --key-file 'E:\GST-private-backup-key\backup.key' --installation-id $installationId --work-directory 'E:\GST-private-work' --artifact 'E:\GST-backups\manual-001.gstbackup' --docker-container gst-billing-invoice-management-system-postgres-1
```

For native PostgreSQL replace `--docker-container ...` with
`--pg-bin-directory 'C:\approved-postgresql\bin'`. Docker is a development adapter,
not the commercial Windows PostgreSQL installer. No credential is passed in
process arguments or emitted in errors. Exit 0 means success; failures emit a
sanitized JSON event and exit 1. Do not suppress failed job alerts.

`verify` checks authentication, archive checksum, installation/schema identity,
then restores into a randomly named `gst_restore_<uuid>` database, validates
migration history, all table counts and application readiness, and drops only
that generated database. It never accepts an existing restore database name,
changes the active connection, or exposes restored data through the API. Restored
ownership/ACLs are deliberately not imported; commercial recovery must provision
and verify least-privilege runtime grants independently.

`currentReleaseCompatible: false` means an authenticated pre-upgrade schema was
verified, not that it is ready for the current API. Only a current-schema restore
also passes current application readiness. Upgrade a separately restored database
through the reviewed migration workflow before considering live cutover.

For actual disaster recovery: stop writers, preserve the failed installation,
verify the backup separately, restore to a new database, recover protected app
configuration and MFA key, validate financial/identity records and permissions,
invalidate restored sessions/recovery authority as appropriate, then explicitly
approve controlled connection cutover. Retain rollback access to the previous
database. The [controlled local switch](recovery-switch.md) now implements database
activation/rollback separately. Service maintenance, configuration custody,
financial review and actual deployment acceptance remain release gates.

## Prepare a quarantined recovery database

The operator can now retain a validated restore instead of discarding it:

```powershell
pnpm backup prepare-recovery --key-file 'E:\GST-private-backup-key\backup.key' --installation-id $installationId --confirm-installation-id $installationId --work-directory 'E:\GST-private-work' --artifact 'E:\GST-backups\manual-001.gstbackup' --docker-container gst-billing-invoice-management-system-postgres-1
```

For native deployment use `--pg-bin-directory` instead of the development Docker
adapter. The confirmation must match the persistent installation UUID. This is
a host/platform-operator command, never a tenant API, and requires the protected
operator database credential. Do not run drills against a customer production
server when an isolated recovery host is available.

By default the command authenticates the archive, requires the running release's exact
migration digest, and creates only `gst_recovery_<random UUID>`. It removes PUBLIC
database privileges before restoring any data. After validating all table counts,
migration history and operator-level readiness, it deletes copied login sessions
and appends a `recovery.prepared` audit event **in the candidate only**. Existing
users/passwords, MFA material, recovery proofs, grants and financial records are
preserved; their original configuration keys and recovery custody are still needed.
No API runtime grants are imported or created. There is no automatic upgrade,
downgrade, license change or tax-policy bypass.

Successful output reports the generated database name, installation identity,
backup time, schema digest and invalidated-session count. The retained database
has `ALLOW_CONNECTIONS false` and no open working connections. This blocks even
new operator connections until an operator deliberately changes it. The original
database remains online and untouched; no application connection or service is
redirected. Ordinary `backup verify` still drops its disposable restore.

Before any later cutover, stop all writers, preserve the old database/release,
review the recovery point and data, recover the correct MFA/application keys,
rotate recovery authority as appropriate, provision least-privilege runtime grants,
and explicitly validate the new connection and financial/history access. These
deployment steps remain release work; use the separate
[controlled local switch](recovery-switch.md) for database activation/rollback.
To inspect a candidate, a qualified
operator can explicitly enable connections to its **returned generated name** on
an isolated host, then disable them again. Never substitute the active database
name or expose it to tenant admins. Retained candidates consume disk and must be
tracked in the operator's recovery record; no automatic retention/deletion occurs.

Failures attempt to drop only the database created by that invocation and clean
its private workspace. OS/server failures can leave an orphan requiring operator
inspection; existing customer databases and backups are never cleanup targets.
Current-schema preparation, actual connection denial, source preservation,
session invalidation, wrong-key/identity/corruption and compiled CLI behavior have
passed against disposable PostgreSQL 18 Docker databases on Windows. Native
PostgreSQL, actual disaster cutover and reboot/service behavior remain unverified.

References: [PostgreSQL database connection control](https://www.postgresql.org/docs/18/sql-createdatabase.html),
[default PUBLIC privileges](https://www.postgresql.org/docs/18/ddl-priv.html).

## Explicit forward upgrade of an older recovery copy

An older supported backup can now be upgraded to the current trusted release in
its **separate generated recovery database**. No active database is migrated or
redirected by this command. First inspect the expected release schema:

```powershell
pnpm db:schema
```

This prints JSON with `schemaDigest` calculated from this release's migration
files. It requires no database credentials/connection and does not describe the
actual live database. Check it against the reviewed release's target digest; do
not use an arbitrary hash or trust unverified files from a downloaded package.

For a deliberate upgrade, add this option to the reviewed prepare-recovery command:

```text
--upgrade-to-schema <exact schemaDigest from the trusted release>
```

The installation UUID confirmation is still required. Only prepare-recovery
accepts this flag. Omitting it preserves the current-schema-only behavior. A wrong
target, unknown/newer migration history or unsupported pre-Phase-5 backup fails
closed; this is not a downgrade or a general migration-directory runner.

The operator tool authenticates the archive, restores its known schema prefix and
checks all manifest table counts before running this installed release's existing
reviewed SQL against the new copy. It then verifies the final history and current
application readiness, clears copied sessions, records both digests in the audit
event and quarantines the result. Output includes `backupSchemaDigest`, final
`schemaDigest` and `upgraded`; the latter is false when the backup was already
current. No backup artifact, user password or active connection is rewritten.
Reviewed migrations can introduce their defined schema/data changes in the copy;
they do not invent runtime grants or activate a license.

Failure attempts connection-disable/drop of only the generated candidate, with
private workspace cleanup. It never attempts a source schema rollback or edits
the backup. Recovering correct configuration/MFA keys, reviewing financial data,
least-privilege runtime provisioning, maintenance and live cutover require
separate steps. The host-only [runtime permission command](runtime-database-access.md)
can now prepare a confirmed candidate without activating it. Maintenance and live
cutover acceptance remain deployment work. The separate
[local switch](recovery-switch.md) performs explicit activation/rollback.
Plain backup verify never upgrades.

## Automation and verification status

Run backups as a dedicated host operator, not via the browser. Choose a backup
interval, off-device rotation, retention and alert destination with the owner;
daily/seven-day retention is only a proposal, not an automatic deletion policy.
No archive pruning is enabled. A scheduled job must use an absolute approved Node
24 path and protected configuration, report nonzero exits, check last-success
age, and run repeated restore drills.

`apps/windows-installer/scripts/Invoke-BackupJob.ps1` is the one-shot job entry
point. Supply an independently verified Node executable/checksum, application
root, protected environment/key paths, output/work directories and approved native
PostgreSQL bin directory (or the explicit development Docker container). It holds
an exclusive job lock, creates a uniquely named encrypted backup, verifies a full
disposable restore, then atomically updates `backup-status.json`. Failure exits 1,
records failure and retains the previous successful timestamp and all archives.
No successful timestamp is recorded for an unverified backup.

`Set-BackupSchedule.ps1` now generates a reviewable Windows task definition by
default (`-Action Definition`). Supply all the same absolute native PostgreSQL
job paths plus `-InstallationName`, the dedicated local `-BackupAccountSid` and an
explicit local `-DailyAt HH:mm`. It never schedules the Docker development adapter.
The definition runs daily and five minutes after boot, catches missed runs, ignores
overlapping triggers, and has a one-hour execution limit. It runs without a logged-in
desktop, under the chosen ordinary account, without elevated task privileges or
execution-policy bypass. Set a schedule that fits the installation's backup duration.
Task settings follow Microsoft's [Task Scheduler settings documentation](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps).
Provision trusted signed scripts or an administrator-approved execution policy
for that account; the task does not weaken Windows execution policy.

Registration is explicit: use `-Action Register -Credential (Get-Credential)` in
an elevated deployment console with the same reviewed arguments. Provision the
dedicated **local non-administrator** account, its batch-logon rights and all ACLs
first; this script does not create accounts or change permissions. The script checks
the credential SID, refuses existing tasks, and rejects reparse-point paths or
untrusted writable dependencies/ancestors. Code, Node and PostgreSQL tools must be
protected throughout their trees (including explicit child-file ACLs); development
symlinks/junctions are rejected. A tree is bounded to 20,000 entries. They must be
admin-controlled; environment and key files must be private, read-only to the
backup account; output/work directories must allow that account to write. Other
non-admin accounts must not read these private files/directories. Task Scheduler
stores the credential; it is never embedded in XML or application configuration.
Domain-account/nested-group policy and restrictive enterprise ACLs need deployment
review; direct local-administrator membership is rejected automatically.

Validate one run under the real account with native PostgreSQL, then a reboot and
missed-run scenario. Inspect Task Scheduler exit status and monitor the output:

```powershell
pnpm backup:health --directory 'E:\GST-backups' --maximum-age-hours 26
```

The age is an **operator-selected example**, not a finalized retention policy.
Exit 0 requires a recent compatible verified restore and its existing artifact;
the recorded schema digest must match the running release's migration files.
An old job status without a digest must be refreshed by a new verified backup.
exit 1 reports missing/invalid status, a failed job, staleness, incompatible schema
or a missing artifact. A failed latest job remains unhealthy even when an earlier
success is recent. Wire this command into the chosen monitoring/alert destination;
the command does not itself deliver email or off-device alerts. It observes job
metadata, not archive authentication: a fresh `backup verify` is still necessary
for recovery. No archive deletion/retention or off-device copying is enabled.

Definition checks include the native Windows Task Scheduler XML parser without
registering a task. No scheduled task was registered on this development laptop.
Actual privileged registration, account access, unattended execution, reboot and
native tools remain unverified. SaaS managed-provider policy and off-device backup
rotation remain deployment work.

Unit corruption/wrong-key/identity/no-overwrite checks and a real PostgreSQL 18
Docker round trip have passed locally on Windows, including private-workspace ACL
creation. The one-shot PowerShell job also passed locally using Docker tools.
Native Windows PostgreSQL tools, power-loss/reboot, scheduled execution,
disk-full failure, off-device recovery and live controlled cutover remain unverified.
CI uses its PostgreSQL service container for the same disposable round trip;
remote CI has not been run from this session.

Sources: [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html),
[PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html),
[Node authenticated encryption](https://nodejs.org/docs/latest-v24.x/api/crypto.html).
