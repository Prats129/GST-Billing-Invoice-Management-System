# Assisted update implementation boundary

The repository contains the update sequencing core, protected file-backed journal
and bound adapters for schema-preserving updates of an already provisioned
dedicated Windows service. It does **not** yet contain an executable production
installer or initial PostgreSQL/service provisioning. No new install command is
advertised, and application startup does not invoke this code. Native Windows
acceptance remains postponed, not passed.

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

The sequencing tests simulate `UpdateHost` contracts. The separate bound adapter
integration test exercises actual encrypted backups, restore verification,
runtime grants and database cutover, mocking only the Windows service boundary.
The native Windows backend is implemented, but its service/task/firewall effects
have only mocked decision tests. They have not been executed on this laptop.

## Bound adapter and supported update scope

`createWindowsUpdateHost` in `windows-update-host.ts` composes the actual database
adapter and Windows service backend. The caller must be a trusted host operator,
not a tenant route. Installed version/schema/root, one fixed journal parent,
release/entitlement public-key trust, runtime binding and script/binary hashes
must come from separately protected installation/operator state. Neither a
download nor tenant input may select those values. No permissive default service,
account, development entitlement bypass or downloaded executable is supplied.

The first bound adapter requires **identical source and target schema digests**,
matching its trusted migration bundle, before any service stop or backup. It
still restores into a separate copy, provisions restricted runtime access and
retains the original database during activation. It does not implement live or
copy-based schema-changing update orchestration; that requires a later matching
updater/recovery release. The underlying standalone recovery tools retain their
existing forward-migration capability.

The database adapter writes `backup.json`, `prepared.json`, `candidate.json`,
`cutover-intent.json` and `cutover-result.json` privately and exclusively with
file flushes. The intent includes original/candidate OIDs and release paths before
the switch, so a lost commit reply requires inspection rather than another swap.
The encrypted backup is retained in that same protected operation directory.
Candidate maintenance inspection uses the existing per-database advisory lock,
withholds runtime CONNECT during temporary operator access and reseals the copy
before restoring that grant. Original and candidate organization sets must match.

`UpdateService.ps1` operates only on an existing `GSTBillingApi` service running
as `NT SERVICE\GSTBillingApi`, with an approved wrapper/runtime and protected,
supported XML definition. It refuses LocalService/LocalSystem/PoC identities,
unknown executable hooks, writable/reparse dependencies, existing failure-action
policies and delayed automatic startup. The first adapter supports ordinary Auto
or Manual startup; it does not silently rewrite an unsupported recovery policy.

Maintenance records the original startup/backup-task state, adds an inbound HTTPS
block for the exact runtime/port, disables the configured backup task and service
startup, stops the service and waits for exit. An already-running backup must
finish first. Other operator/import/inspection writers must also be stopped;
database idle/prepared-transaction checks do not excuse operator coordination.
The block stays active through private Manual startup and HTTPS/child-process/
listener ownership checks. Admission restores the recorded startup/task state and
removes only this operation's block. No CA trust or existing LAN allow rule is
changed. Whether local trusted HTTPS probes behave correctly behind the block
on the supported Windows/firewall matrix remains an actual VM acceptance test.

Selection validates the candidate tree, grants the dedicated service read/execute
access, preserves `previous-service.xml`, then atomically replaces the service
XML with the candidate entry/working directory and a matching WEB_ROOT override.
The original runtime environment, database URLs, keys and installation identity
are preserved. The backend checks the environment file hash and exact offline/
production/runtime/installation binding, refusing operator database credentials
in the service environment. Helpers are read and hash-verified, then executed as
those exact bytes over stdin. Their child environment excludes inherited operator
database credentials and keys; only system paths, action and nonsecret service
configuration are passed. Expected script hashes must be independently trusted.

The adapter is a host library entrypoint, **not** a commercially accepted updater
CLI. Its first native invocation belongs on the postponed disposable host/client
environment. Initial service/cluster provisioning, durable installed-state
management, signed native packaging and guided rollback/uninstall are not supplied
by this update adapter.

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

The bound adapter persists release/configuration references and database OIDs and
uses `acquireUpdateJournal` for actual locking/recording. The future installer must
provision and protect its installation state, service identity, binaries and
stable journal location, then validate the complete lifecycle on disposable
Windows machines. The LocalService PoC is not promoted into a production installer.

Unfinished work also includes initial dedicated PostgreSQL installation, signing
and redistribution approval, startup/recovery policies, operator-guided rollback,
data-preserving uninstall and actual disposable host/client tests. A journal alone
does not recover a machine; the native adapter and operator recovery workflow are
still required. See [Windows checks](windows-deployment-checks.md),
[signed releases](signed-releases.md) and [release gaps](phase-6-release-gaps.md).
No service, task, trust store, firewall, live database or laptop startup setting
was changed while implementing or testing this core.
