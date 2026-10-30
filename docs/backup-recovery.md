# Host-operated encrypted backup and restore verification

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
database. These cutover steps remain a release gate and are not automated here.

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

The installer/operator must still register this job under the correct dedicated
Windows identity at an explicitly selected interval, with non-overlapping task
execution, startup/missed-run behavior and failure/staleness alerts. No scheduled
task was registered on this development laptop. SaaS managed-provider policy and
backup retention/off-device rotation remain deployment work.

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
