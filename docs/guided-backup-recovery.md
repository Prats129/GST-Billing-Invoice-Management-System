# Guided backup and recovery

This is a **host/operator workflow**, not a tenant permission. The assistant
reuses encrypted backups and isolated restore verification for Billing and adds
a separate Platform Admin schema adapter. No browser runs commands, reads keys,
downloads shared backups or receives database-administrator credentials.

## Start here

Use the pinned project toolchain in a real PowerShell terminal:

```powershell
& ./scripts/Use-ProjectToolchain.ps1
pnpm backup:guided
```

Choose an action from the menu. Existing `backup`, `backup:health`,
`recovery:runtime` and `recovery:switch` commands remain available for existing
reviewed procedures; the assistant does not replace installed Windows backup
jobs or their trusted-release selection.

### First-time profile preparation: `init`

Prepare protected local storage and a separate protected off-device recovery-kit
destination first. Do not use the repository, a shared folder or an unencrypted
temporary volume for keys/plaintext work. This command does not enable disk
encryption or configure key escrow for you.

The assistant asks for:

1. A **new** private profile folder. Existing folders are refused.
2. Billing, Platform Admin or both. Each has its own database identity and key.
3. An existing protected operator environment file. Billing reads
   `MIGRATION_DATABASE_URL`; Platform reads `PLATFORM_MIGRATION_DATABASE_URL`.
   Guided setup's protected `operator.env` can supply both. Credentials are read
   from that file, not entered as terminal arguments or embedded in the profile.
4. The independently verified database name. Connections must be loopback
   PostgreSQL without URL options. The profile pins the cluster's system ID and
   the database OID. The host role needs approved backup/restore permissions,
   including creating isolated databases and reading `pg_control_system()`.
   These privileges never belong to an application runtime account.
5. **Reuse** for an existing backup key and persistent installation UUID, or
   **new** only for the first backup identity. New creates a separate random
   32-byte key after securing the profile folder. It never replaces a key. A
   replacement cannot recover old archives. Backup identity is distinct from
   entitlement/installation binding unless an existing reviewed configuration
   explicitly uses the same UUID.
6. Private archive/work folders, a maximum verified-backup age that you choose,
   and approved PostgreSQL 18 binaries or the local development Docker adapter.
   Folder parents must already exist. Existing directories must pass the private
   access checks; the tool does not silently weaken or repair their permissions.
7. Explicit acknowledgement of recovery-kit custody and the reviewed targets.
   An optional **separate** publication folder enables status reporting after
   jobs. Keep it outside profiles and away from keys, environments and archives.

The profile holds paths/identities and policy, not copies of database passwords.
It is still private. Preserve its original keys/UUIDs, operator and runtime
configuration, MFA encryption keys, host recovery proofs and other required
configuration in the recovery kit. Keep the authoritative publisher register,
public trust and signing custody under their independent procedure. A database
backup does not replace any of these.

If initialization is interrupted, inspect the new folder. Do not delete evidence,
overwrite a generated key or repeatedly run `init` at the same path. The profile
and key files use exclusive creation. A profile missing its key cannot run a job.

## Normal protection

| Action    | Effect                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup`  | Create a uniquely named encrypted archive, then actually restore/validate an isolated copy before recording success.                                                    |
| `verify`  | Re-authenticate an existing recorded archive and repeat the isolated restore drill. Does not change the active database.                                                |
| `status`  | Check saved outcomes, schema/age and archive presence/hash. A later failure or unconfirmed job cannot be hidden behind an earlier success.                              |
| `publish` | Write only a validated, sanitized status report to the selected separate directory.                                                                                     |
| `export`  | Repeat verification, then copy only the encrypted archive to the chosen off-device folder with checksum comparison and no overwrite. Keys/configuration are not copied. |
| `inspect` | List job outcomes, planned candidates and marked owned recovery databases for review. No automatic deletion.                                                            |

Creation and verification are separate recorded stages of the same job. Fixed
progress messages show source checks, archive creation, restore verification and
result recording. PostgreSQL advisory locks serialize jobs per source database
and release on process failure. A saved job without a result blocks another job
until inspection. Database/file errors are reduced to safe error categories;
credentials and private SQL/driver errors are never printed or published.

Archives are generated inside the configured archive folder. UI/file inputs do
not select an arbitrary restore target or command. Workspaces are private and
successful/ordinary failed jobs clean up only their generated plaintext child.
A power loss can leave a workspace or database requiring host inspection.

### Scheduling

An already approved host scheduler can invoke this fixed noninteractive entry:

```powershell
pnpm backup:guided run "C:\Protected-backup-profile" billing
```

Substitute the actual profile and target ID (`billing` or `platform`). Use the
trusted absolute Node/toolchain and dedicated host identity for production;
capture nonzero exits and alert on stale status. An optional configured
publication directory is updated after successful or failed jobs. A failed
publication is an operational failure even if the archive itself was verified;
inspect saved results rather than creating a replacement blindly.

This entry point does not register Windows tasks, change credentials, pick a
retention period, prune archives or configure a cloud provider. Existing Windows
scheduled backup jobs retain their service-account/release-pointer safeguards.
Native scheduling/UI acceptance belongs to the postponed Windows environment;
provider-bound schedules and alerts need the selected SaaS environment. There
is no invented default retention policy or automatic deletion in this batch.

## Read-only Admin UI

Open **Platform Admin → Operations → Backup & recovery status**. Initially it
explains that no report is connected.

After publishing, the host can set this **non-secret path** in `.env.admin`:

```dotenv
PLATFORM_BACKUP_STATUS_FILE=C:/GST-backup-status/backup-status.json
```

Restart the Admin API after changing configuration. Grant its restricted OS
identity read-only access to that publication file/directory. Do not grant it
access to the profile, backup keys, operator environments or archive folders.
The example path is a placeholder; the host must select and secure the actual
destination. No browser can modify it.

The panel shows the last report/attempt/verified-drill times, configured maximum
age and actionable status. Missing, stale, failed, changed or incompatible
archives do not display as verified protection. Unconfirmed means the job could
still be running or could have been interrupted. Refresh reloads the fixed
publication; it does not run a backup. The API rechecks report age and refuses
oversized, malformed, future-dated or unexpectedly shaped reports. This panel
does not claim live filesystem verification, off-device availability or recovery
key custody.

Only the fully MFA-authenticated platform owner can read this endpoint. Customer
cookies/roles and incomplete platform MFA sessions cannot use it. No controls
are added to the Billing app for whole-server backups or restores.

## Recovery preparation: `recover`

Select the original profile, target and a recorded archive filename. Confirm the
persistent installation UUID. The engine authenticates the archive/key/domain,
checks schema and row counts, and restores into a **new generated database**.
The planned candidate name is flushed before creation so an interrupted response
retains inspection evidence.

Billing recovery uses the existing customer engine, clears copied sessions and
trusted devices, records recovery evidence and seals the candidate. The original
source and its connection remain unchanged. The assistant uses the exact current
schema; deliberately upgrading an older Billing recovery copy remains the
reviewed [existing host procedure](backup-recovery.md#explicit-forward-upgrade-of-an-older-recovery-copy).

Platform recovery uses its own migration digest, expected platform tables,
append-only triggers and commercial-balance checks. It rejects the customer
schema. Before sealing it, the engine revokes copied platform sessions and sets
`operations_enabled=false`, while preserving owner MFA/recovery keys, audit,
commercial history and operation payloads. An old enabled flag in the dump does
not resume the restored worker. Recovery preparation never enables authority.

### Billing cutover and rollback

After preparing a confirmed candidate:

1. Use `runtime-grants` with the **completed recovery job UUID** and protected
   Billing runtime environment file. It invokes the existing restricted runtime
   provisioning engine for that recorded candidate, not a user-supplied SQL
   target. Inspect the candidate and financial/history/configuration recovery
   point separately.
2. Use `cutover-status` before making a decision, especially after an uncertain
   response. It invokes the existing switch engine's database/audit checks.
3. Stop all services, APIs, workers and scheduled writers. The assistant does
   not guess which OS processes it is allowed to terminate.
4. `activate` requires the exact active name and explicit stopped-writer/recovery
   review confirmation. The engine validates identities, schema, grants, clients
   and evidence, atomically swaps names, and retains the old database sealed.
5. Inspect status and runtime/financial/history behavior before restarting.
6. `rollback` additionally requires explicit acknowledgement of losing access
   to post-cutover writes. It reuses the reviewed rollback engine and retains
   both database copies; there is no automatic rollback or deletion.

The assistant flushes a switch-intent record before the engine and a result
after confirmed completion. If a connection/response is lost, keep writers
stopped and inspect `cutover-status`; failure does not prove nothing committed.
An OID change deliberately invalidates the old backup profile. After review,
create a new profile reusing the original key/installation UUID and retaining
the old profile/job evidence; never edit the old OID to hide a mismatch.

### Platform reconciliation and activation boundary

Use `reconcile` with the **completed platform recovery job UUID**. When both
targets are configured, it reads bounded consistent snapshots of the restored
platform and current Billing operator receipts. It reports missing receipts,
conflicting payloads, committed-but-unreconciled operations, missing hosted
organizations and unknown installed grants. Payloads, tokens and credentials are
not included in its saved discrepancy report. The report does not mutate either
history, replay pending work or enable the worker. The candidate is sealed again
after inspection, including on normal failures.

If Billing is unavailable, reconciliation stops. With no Billing target it is
explicitly incomplete (`billingChecked=false`). More than 5,000 operations,
receipts or SaaS organizations requires a reviewed full host reconciliation,
rather than silently treating a truncated report as complete. The snapshots are
observations; they do not freeze a changing SaaS installation.

The operator must separately review the authoritative publisher register/trust,
offline deliveries and all discrepancies. Missing externally committed history
must never be repaired by resetting the register, reissuing grants or rolling
back SaaS to match the older portal.

Platform live activation and reviewed runtime-role reapplication still use the
[platform host recovery procedure](platform-admin.md#backups-restore-and-reconciliation),
with the Admin API stopped and the restored worker disabled. The assistant does
not invent an automatic platform cutover or turn a discrepancy report into
authority approval. Only the existing explicit host enablement may resume
processing **after** reconciliation. The ordinary Admin UI has no enable button.

## Interrupted work and retained evidence

`inspect` shows immutable job/result files, planned candidate identities and
owned databases bearing the matching installation/domain marker. It never offers
deletion of an arbitrary database/path. An unmarked database is not proven owned
by this profile; inspect it separately with a qualified operator.

After checking that a job is no longer running and reviewing its archive,
candidate and plaintext workspace, `acknowledge-interrupted` records that review.
It must acquire the same database lock, so it cannot acknowledge an active job.
It neither deletes artifacts nor treats the backup as successful. A new verified
job can then proceed. Keep unresolved evidence, old active databases and required
recovery points; scoped deletion/retention remains a deliberate host operation.

## Validation and release limits

See [review coverage](review-coverage.md) for executed unit, PostgreSQL and browser
tests and their precise results. Test fixtures use disposable databases,
ephemeral keys and private temporary profiles.

This implements local host engineering and safe published status. Prepared
encrypted storage, genuine recovery-kit custody, retention/alert policies,
production hosting, native scheduled-account behavior and real Windows
installation/reboot/LAN acceptance remain external inputs or later batches.
No real customer/platform database or private environment is changed by tests.
