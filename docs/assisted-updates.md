# Assisted update implementation boundary

The repository contains the update sequencing core, protected file-backed journal
and bound adapters for supported forward-copy updates of an already provisioned
dedicated Windows service. Operator-run initial PostgreSQL/service provisioning,
retained-data repair/reinstallation and preserving uninstall are documented in
[Windows installation](windows-installation.md). Distribution signing and native
Windows acceptance remain outstanding; no approved commercial installer release
is implied. Application startup does not invoke these host commands.

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

The bound adapter requires the **target schema to match its independently trusted
operator migration bundle** before any service stop or backup. The source must be
a verified supported prefix, bound to protected installed state and the signed
package. It restores into a separate generated copy, explicitly confirms the
target to the existing forward migrator, provisions restricted runtime access and
retains the original database during activation. No migration directory comes
from tenant input or an archive, and the active source is never migrated.

Cutover evidence records both schema digests. Database audit evidence binds the
retained schema to the exact original/candidate OIDs and installation. Explicit
rollback verifies that retained migration history before changing names, probes
the runtime against the retained release's reviewed structure and restores the
original schema in installed metadata alongside the original version/root.
There is no down migration. Legacy schema-preserving receipts remain supported;
missing evidence never authorizes an inferred schema change.

Retained readiness is reviewed for Phase 5, Phase 6 and the matching current
operator release. Other intermediate schemas require reviewed compatibility
probes before activation. Normal API startup still requires the full current
schema. All-organization maintenance checks remain mandatory: a pre-licensing
Phase 5 database lacks the entitlement table and is therefore **not** admitted by
the commercial update orchestrator. The real Phase 5-to-6 database drill tests
migration/rollback mechanics, not a maintenance bypass or a licensed install.
Different-schema orchestration fault tests use mocked database ports; actual
Windows file/service cutover remains unverified.

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
environment. Initial service/cluster provisioning, signed native packaging and
data-preserving uninstall are not supplied by this update adapter. Protected
installed-state management and explicit guided recovery are implemented below.

## Journals, interruption and failure

The host adapter now requires a private `installation.json` in the single
operator-configured journal parent. It records installation UUID, current app
root, version, schema digest and last operation, without credentials. The initial
installer must create it exclusively using `initializeInstallationState`, after
protecting and validating the deployment. Updates refuse missing/mismatched state;
they do not silently adopt an existing installation. Compare-before-replace and
same-directory atomic rename commit selected state before admitting users. The
operation retains the before/after intent so a failed admission can be recovered.
Development API startup is unaffected and does not create this record.

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

## Explicit failed-update recovery

`inspectFailedUpdate` reads bounded private journal/owner/cutover evidence and
actual database names/OIDs without changing ACLs, files or business data. It
reports `before_cutover`, `activated`, `not_activated` or `unknown`. A missing
intent after switch/start intent is unknown; a failed command reply is not proof
of rollback. These are host-library functions, not a tenant endpoint or a new
customer command to run on this laptop.

`recoverFailedUpdate` requires the original installation UUID, confirmation that
the updater has stopped and acceptance of the recovery point. Restoring the
retained database omits writes made in the candidate; that candidate remains
retained, not merged or deleted. The recovery claim is exclusive and never stolen
by a timeout. The routine verifies original signed files against protected
installed version/schema/root, requires exact observed database OID pairs, stops
writers and reinspects state before an explicit rollback through the existing
database switch tool. It restores the retained service XML, starts the original
privately, checks runtime/database/HTTPS readiness, restores installed metadata
and admits users. Active maintenance is not required to restore an already
installed release; existing authorization, licensing and compliance gates remain.

The Windows backend supplies Restore/StartOriginal/ReadyOriginal/AdmitOriginal
actions, preserving the retired candidate service definition. Actual native file
replacement/service/firewall acceptance remains postponed; safe tests mock these
machine effects. An interrupted/failed recovery keeps both locks and copies for
inspection. A lost rollback reply is never automatically retried. After verified
success, one atomic rename archives the entire original lock and recovery
receipts under the operation journal, releasing the fixed update lock without
erasing evidence. Uncertain or contradictory metadata never authorizes unlock.

## Remaining implementation and acceptance

The bound adapter persists release/configuration references and database OIDs and
uses `acquireUpdateJournal` for actual locking/recording. The future installer must
provision and protect its installation state, service identity, binaries and
stable journal location, then validate the complete lifecycle on disposable
Windows machines. The LocalService PoC is not promoted into a production installer.

Unfinished work includes initial dedicated PostgreSQL installation, signing and
redistribution approval, startup/recovery policies, production acceptance of
schema-changing updates, data-preserving uninstall and actual disposable host/client tests.
Supported forward-copy recovery is implemented locally as described above; it is not
a production-accepted installer UI. See [Windows checks](windows-deployment-checks.md),
[signed releases](signed-releases.md) and [release gaps](phase-6-release-gaps.md).
No service, task, trust store, firewall, live database or laptop startup setting
was changed while implementing or testing this core.
