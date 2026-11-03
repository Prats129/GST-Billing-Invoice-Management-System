import { z } from 'zod';
import type { EntitlementTrust } from '../licensing/entitlement.js';
import { verifyReleasePackage } from './release-package.js';
import type { ReleaseManifest } from './release-package.js';

export type UpdatePhase =
  | 'acquired'
  | 'validated'
  | 'stopping'
  | 'stopped'
  | 'backing_up'
  | 'preparing'
  | 'ready_to_switch'
  | 'switching'
  | 'starting'
  | 'validating'
  | 'completed'
  | 'recovery_required';

export interface UpdateRecord {
  operationId: string;
  installationId: string;
  version: string;
  phase: UpdatePhase;
}

export interface UpdateBackup {
  // Opaque host-owned references, never shell commands or connection strings.
  reference: string;
  installationId: string;
  schemaDigest: string;
  verified: true;
}

export interface UpdateCandidate {
  reference: string;
  installationId: string;
  schemaDigest: string;
  quarantined: true;
  runtimeAccessVerified: true;
}

/**
 * Privileged Windows adapters must implement these guarantees before wiring an
 * installer entrypoint. No default/no-op service adapter is supplied.
 */
export interface UpdateHost {
  // Reject concurrent operations AND any unreconciled previous journal. Keep the
  // lock through final recording; never steal an abandoned lock automatically.
  acquire(): Promise<{ release(): Promise<void> }>;
  // Append and durably flush BEFORE returning. Store records in protected local
  // storage; references/OIDs/paths belong in its private host recovery record.
  record(value: UpdateRecord): Promise<void>;
  // Read installed signed entitlements for ALL organizations using current local
  // time/rollback observations and original binding. Also validate the copy if given.
  assertMaintenance(candidate?: UpdateCandidate): Promise<void>;
  // Must disable service/job restarts, stop ingress and all writers, verify idle
  // database/runtime clients and hold that exclusion until finish or recovery.
  stopWriters(): Promise<void>;
  // Make a NEW backup of the stopped original and perform a real restore drill.
  backupAndVerify(): Promise<UpdateBackup>;
  // Restore into a NEW generated database, apply forward-only trusted migrations,
  // validate target schema/data/runtime grants and leave connections quarantined.
  prepareCandidate(
    backup: UpdateBackup,
    manifest: ReleaseManifest,
  ): Promise<UpdateCandidate>;
  // While exclusion is held, retain original files/database/configuration, record
  // names/OIDs, and activate the candidate and matching immutable staged files.
  // A thrown error may mean COMMIT succeeded: never infer rollback from rejection.
  activate(candidate: UpdateCandidate): Promise<void>;
  // Start ONLY the selected candidate with original keys and installation UUID.
  // External ingress/background jobs must still remain stopped.
  startCandidate(): Promise<void>;
  // Real runtime DB readiness, HTTPS/host/frontend and expected version/schema.
  assertReady(manifest: ReleaseManifest): Promise<void>;
  // Admission/restart-policy restoration is an effect and can fail ambiguously.
  admitUsers(): Promise<void>;
  // Idempotently disable restarts, block ingress and stop all writers on failure.
  // Never restore an old schema/release, delete a copy or admit users here.
  keepStopped(): Promise<void>;
}

export class AssistedUpdateError extends Error {
  constructor(
    readonly phase: UpdatePhase,
    readonly recoveryRequired: boolean,
    readonly stopConfirmed: boolean,
    readonly failureRecorded: boolean,
  ) {
    super(
      'Assisted update failed. Inspect the protected update record before retrying.',
    );
  }
}

const reference = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const identity = {
  reference,
  installationId: z.string().uuid(),
  schemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
};
const backupSchema = z
  .object({ ...identity, verified: z.literal(true) })
  .strict();
const candidateSchema = z
  .object({
    ...identity,
    quarantined: z.literal(true),
    runtimeAccessVerified: z.literal(true),
  })
  .strict();

/**
 * Safety sequencing core, not a production Windows installer. Package signature
 * verification is concrete; native service/database transactions are explicit
 * host ports, to be bound only after disposable Windows acceptance.
 */
export async function runAssistedUpdate(options: {
  operationId: string;
  installationId: string;
  stagedRoot: string;
  releaseTrust: EntitlementTrust;
  installed: { version: string; schemaDigest: string };
  host: UpdateHost;
}): Promise<UpdateRecord> {
  const { host } = options;
  let phase: UpdatePhase = 'acquired';
  let lock: Awaited<ReturnType<UpdateHost['acquire']>> | undefined;
  let stoppingAttempted = false;
  let lastRecord: UpdateRecord | undefined;
  let outcome: UpdateRecord | undefined;
  let failure: AssistedUpdateError | undefined;
  const record = async (next: UpdatePhase, version: string) => {
    phase = next;
    const value: UpdateRecord = {
      operationId: options.operationId,
      installationId: options.installationId,
      version,
      phase,
    };
    await host.record(value);
    lastRecord = value;
    return value;
  };
  try {
    z.string().uuid().parse(options.operationId);
    z.string().uuid().parse(options.installationId);
    lock = await host.acquire();
    const manifest = await verifyReleasePackage(
      options.stagedRoot,
      options.releaseTrust,
      options.installed,
    );
    // Pin metadata against mutation by either the staged directory or an adapter.
    const pinned = JSON.stringify(manifest);
    await record('acquired', manifest.version);
    await host.assertMaintenance();
    await record('validated', manifest.version);
    await record('stopping', manifest.version);
    stoppingAttempted = true;
    await host.stopWriters();
    await record('stopped', manifest.version);
    await host.assertMaintenance();
    await record('backing_up', manifest.version);
    const backup = Object.freeze(
      backupSchema.parse(await host.backupAndVerify()),
    );
    if (
      backup.installationId !== options.installationId ||
      backup.schemaDigest !== manifest.fromSchemaDigest
    )
      throw new Error();
    await record('preparing', manifest.version);
    const candidate = Object.freeze(
      candidateSchema.parse(
        await host.prepareCandidate(backup, structuredClone(manifest)),
      ),
    );
    if (
      candidate.installationId !== options.installationId ||
      candidate.schemaDigest !== manifest.toSchemaDigest ||
      candidate.reference === backup.reference
    )
      throw new Error();
    await record('ready_to_switch', manifest.version);
    const reverified = await verifyReleasePackage(
      options.stagedRoot,
      options.releaseTrust,
      options.installed,
    );
    if (JSON.stringify(reverified) !== pinned) throw new Error();
    // Fresh check after backup/migration work, immediately before installing;
    // never use a saved CLI success as an entitlement authorization token.
    await record('switching', manifest.version);
    await host.assertMaintenance(candidate);
    await host.activate(candidate);
    await record('starting', manifest.version);
    await host.startCandidate();
    await record('validating', manifest.version);
    await host.assertReady(structuredClone(manifest));
    await host.admitUsers();
    outcome = await record('completed', manifest.version);
  } catch {
    const failedAt = phase;
    let stopConfirmed = false;
    let failureRecorded = false;
    if (stoppingAttempted) {
      try {
        await host.keepStopped();
        stopConfirmed = true;
      } catch {
        /* Report uncertain shutdown explicitly. */
      }
    }
    if (lock && lastRecord) {
      try {
        await record('recovery_required', lastRecord.version);
        failureRecorded = true;
      } catch {
        /* Never mask journal failure. */
      }
    }
    failure = new AssistedUpdateError(
      failedAt,
      stoppingAttempted,
      stopConfirmed,
      failureRecorded,
    );
  }
  if (lock) {
    try {
      await lock.release();
    } catch {
      // A failed unlock must not report success or silently restart/admit users.
      let stopped = false;
      if (stoppingAttempted) {
        try {
          await host.keepStopped();
          stopped = true;
        } catch {
          /* Operator must inspect. */
        }
      }
      let recorded = false;
      if (lastRecord) {
        try {
          await record('recovery_required', lastRecord.version);
          recorded = true;
        } catch {
          /* Operator must inspect. */
        }
      }
      failure = new AssistedUpdateError(
        phase,
        stoppingAttempted,
        stopped,
        recorded,
      );
    }
  }
  if (failure) throw failure;
  if (!outcome)
    throw new AssistedUpdateError(phase, stoppingAttempted, false, false);
  return outcome;
}
