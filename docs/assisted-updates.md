# Assisted update implementation boundary

The repository now contains the update sequencing core and a real protected
file-backed journal/lock. It does **not** yet contain an executable production
Windows installer or a bound native service/database adapter. No new install
command is advertised, and application startup does not invoke this code.

## Implemented sequence

`apps/api/src/operations/assisted-update.ts` coordinates these operations:

1. Acquire the installation's exclusive host lock; reject unresolved prior work.
2. Verify the staged package's actual signature, inventory and compatibility
   against protected installed version/schema state, using existing verification.
3. Check maintenance for all organizations, record intent, then stop ingress,
   writers, automatic service restarts and background jobs.
4. Recheck maintenance and create a new encrypted backup with a real restore
   drill. Require a receipt for the original installation and schema.
5. Restore/migrate a separate quarantined candidate, verify the target schema,
   financial data and runtime permissions. Never migrate the active database.
6. Verify the staged package again after preparation. Record switch intent and
   recheck maintenance on both the original and candidate immediately before
   activation. A previous eligibility CLI result cannot authorize this step.
7. Activate matching application/database copies while retaining the originals.
   Start the candidate privately and verify actual readiness before admitting
   users or restoring restart/background-job policies.

Windows operations in this sequence are explicit `UpdateHost` contracts, not
implemented service calls. Tests supply simulated native/database operations.
Package verification is real, as are the optional journal files/ACL operations.
An adapter returning an unchecked receipt does not prove backup, migration or
Windows acceptance: it must bind the existing tested database tools to the actual
protected installation before this runner can be exposed to an operator.

## Journals, interruption and failure

`update-journal.ts` supplies exclusive `mkdir` locking under one fixed private
operator-configured parent per installation. A random owner token binds the lock.
Each operation creates a new private `gst-update-<UUID>` directory. Windows NTFS
protection and ancestor/reparse/owner checks reuse the release-staging guard;
POSIX uses private modes and ownership checks. No paths come from package content
or tenant requests. Provision the parent outside signed application trees.

Records contain only operation/installation IDs, target version, fixed phase and
local recording time. Strict validation rejects extra fields, including secrets.
Writes are serialized and file contents flushed with `FileHandle.sync()` before
returning. Storage errors stop further writes. This is not a claim that every
filesystem/controller preserves metadata through power loss; native crash/reboot
acceptance and storage durability testing remain required.

Successful completion releases the lock after checking its exact owner token;
the journal is retained. A failure before any operation record can release its
unused lock. Incomplete/failed operations retain their lock after handles close.
Partial initialization, unknown lock files or ambiguous storage failures are not
automatically cleaned up. There is no timeout-based lock stealing or automatic
resume after reboot. Operator reconciliation must inspect the journal, actual
service configuration and database OIDs before permitting another update.

After any attempt to stop writers, failure invokes `keepStopped`, records
`recovery_required` if possible and preserves all candidate/original/backup data.
The error separately reports whether stopping and failure recording succeeded.
A failed activation can mean PostgreSQL COMMIT succeeded but its reply was lost;
the runner never infers rollback from that error, retries activation, downgrades a
schema, restarts old code or deletes recovery copies. An admission or final
journal/unlock failure also cannot report update success. Recovery after users
may have written requires an explicit recovery-point decision, not automatic
restoration of old data.

## Remaining implementation and acceptance

The native adapter must persist actual protected release/configuration paths,
database names/OIDs and backup references in its own recovery record, enforce a
single trusted journal location, authenticate the expected service and hold writer
exclusion across package checking, maintenance checking and activation. It must
connect `acquireUpdateJournal` to `acquire`/`record` rather than supplying no-op
locking or logging. It must implement service/file cutover and recovery against
approved Windows binaries and a dedicated production identity. The LocalService
PoC is not silently promoted into a production installer.

Unfinished work also includes initial dedicated PostgreSQL installation, signing
and redistribution approval, startup/recovery policies, operator-guided rollback,
data-preserving uninstall and actual disposable host/client tests. A journal alone
does not recover a machine; the native adapter and operator recovery workflow are
still required. See [Windows checks](windows-deployment-checks.md),
[signed releases](signed-releases.md) and [release gaps](phase-6-release-gaps.md).
No service, task, trust store, firewall, live database or laptop startup setting
was changed while implementing or testing this core.
