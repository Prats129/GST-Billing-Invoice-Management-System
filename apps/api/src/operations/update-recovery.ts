import { lstat, readFile, mkdir, open, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  inspectUpdateDatabase,
  updateConnections,
  recoverySwitchStatus,
  switchRecovery,
  assertRecoveryRuntimeReady,
} from '@gst/database/operations';
import type { EntitlementTrust } from '../licensing/entitlement.js';
import { assertPrivateDirectory, secureDirectory } from './release-staging.js';
import { recordSchema } from './update-journal.js';
import {
  parseReleaseManifest,
  verifyReleasePackage,
} from './release-package.js';
import {
  readInstallationState,
  replaceInstallationState,
} from './installation-state.js';

export interface UpdateRecoveryOptions {
  operationId: string;
  installationId: string;
  journalParent: string;
  installedRoot: string;
  stagedRoot: string;
  installed: { version: string; schemaDigest: string };
  connectionString: string;
  runtimeConnectionString: string;
  releaseTrust: EntitlementTrust;
}
export interface UpdateRecoveryService {
  stop(): Promise<void>;
  restoreOriginal(): Promise<void>;
  startOriginal(): Promise<void>;
  assertOriginalReady(): Promise<void>;
  admitOriginal(): Promise<void>;
}
export class UpdateRecoveryError extends Error {
  constructor() {
    super(
      'Update recovery requires operator inspection. Keep maintenance active; do not clear operation locks or guess database state.',
    );
  }
}
const database = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/);
const version = z
  .string()
  .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
const ownerSchema = z
  .object({
    operationId: z.string().uuid(),
    installationId: z.string().uuid(),
    nonce: z.string().uuid(),
  })
  .strict();
const intentSchema = z
  .object({
    activeDatabase: database,
    recoveryDatabase: z.string().regex(/^gst_recovery_[a-f0-9]{32}$/),
    previousDatabase: database,
    databases: z
      .array(
        z
          .object({
            name: database,
            oid: z.number().int().positive(),
            open: z.boolean(),
            owned: z.boolean(),
          })
          .strict(),
      )
      .length(2),
    installedRoot: z.string(),
    stagedRoot: z.string(),
    installedVersion: version,
    targetVersion: version,
    // Legacy schema-preserving journals omit both fields.
    installedSchemaDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    targetSchemaDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
async function textFile(path: string, maximum: number, optional = false) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximum)
      throw new UpdateRecoveryError();
    const bytes = await readFile(path);
    if (bytes.length > maximum) throw new UpdateRecoveryError();
    return bytes.toString('utf8');
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined;
    throw new UpdateRecoveryError();
  }
}
async function evidence(options: UpdateRecoveryOptions) {
  z.string().uuid().parse(options.operationId);
  z.string().uuid().parse(options.installationId);
  const parent = resolve(options.journalParent);
  const root = join(parent, 'gst-update-' + options.operationId);
  const lock = join(parent, 'gst-update.lock');
  await assertPrivateDirectory(root);
  await assertPrivateDirectory(lock);
  const ownerText = (await textFile(join(lock, 'owner.json'), 1024))!;
  const owner = ownerSchema.parse(JSON.parse(ownerText));
  if (
    owner.operationId !== options.operationId ||
    owner.installationId !== options.installationId
  )
    throw new UpdateRecoveryError();
  const eventsText = (await textFile(join(root, 'events.jsonl'), 1024 * 1024))!;
  if (!eventsText.endsWith('\n')) throw new UpdateRecoveryError();
  const lines = eventsText
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const header = z
    .object({
      event: z.literal('update_journal_created'),
      operationId: z.string().uuid(),
      installationId: z.string().uuid(),
      recordedAt: z.string().datetime(),
    })
    .strict()
    .parse(lines.shift());
  if (
    header.operationId !== owner.operationId ||
    header.installationId !== owner.installationId
  )
    throw new UpdateRecoveryError();
  const records = lines.map((line) =>
    recordSchema.extend({ recordedAt: z.string().datetime() }).parse(line),
  );
  if (
    records.some(
      (r) =>
        r.operationId !== owner.operationId ||
        r.installationId !== owner.installationId,
    )
  )
    throw new UpdateRecoveryError();
  const raw = await textFile(join(root, 'cutover-intent.json'), 32768, true);
  const intent = raw ? intentSchema.parse(JSON.parse(raw)) : undefined;
  const binding = updateConnections(
    options.connectionString,
    options.runtimeConnectionString,
  );
  if (
    intent &&
    (intent.activeDatabase !== binding.database ||
      intent.previousDatabase !==
        intent.recoveryDatabase.replace('gst_recovery_', 'gst_previous_') ||
      intent.installedRoot !== options.installedRoot ||
      intent.stagedRoot !== options.stagedRoot ||
      intent.installedVersion !== options.installed.version ||
      (intent.installedSchemaDigest !== undefined &&
        intent.installedSchemaDigest !== options.installed.schemaDigest) ||
      (intent.installedSchemaDigest === undefined) !==
        (intent.targetSchemaDigest === undefined))
  )
    throw new UpdateRecoveryError();
  return { root, lock, ownerText, records, intent, binding };
}
type Evidence = Awaited<ReturnType<typeof evidence>>;
async function state(options: UpdateRecoveryOptions, value: Evidence) {
  if (!value.intent) {
    if (
      value.records.some((r) =>
        ['switching', 'starting', 'validating', 'completed'].includes(r.phase),
      )
    )
      return 'unknown' as const;
    await inspectUpdateDatabase(options, async (_db, digest) => {
      if (digest !== options.installed.schemaDigest)
        throw new UpdateRecoveryError();
    });
    return 'before_cutover' as const;
  }
  const intent = value.intent;
  const original = intent.databases.find(
    (r) => r.name === intent.activeDatabase,
  );
  const candidate = intent.databases.find(
    (r) => r.name === intent.recoveryDatabase,
  );
  if (
    !original?.owned ||
    !candidate?.owned ||
    !original.open ||
    candidate.open ||
    original.oid === candidate.oid
  )
    throw new UpdateRecoveryError();
  const observed = await recoverySwitchStatus({
    ...options,
    recoveryDatabase: intent.recoveryDatabase,
    confirmActiveDatabase: intent.activeDatabase,
    confirmWritersStopped: false,
  });
  const matches = (name: string, oid: number, open: boolean) =>
    observed.databases.some(
      (r) => r.name === name && r.oid === oid && r.open === open && r.owned,
    );
  if (
    observed.databases.length === 2 &&
    matches(intent.activeDatabase, candidate.oid, true) &&
    matches(intent.previousDatabase, original.oid, false)
  )
    return 'activated' as const;
  if (
    observed.databases.length === 2 &&
    matches(intent.activeDatabase, original.oid, true) &&
    matches(intent.recoveryDatabase, candidate.oid, false)
  )
    return 'not_activated' as const;
  return 'unknown' as const;
}
export async function inspectFailedUpdate(options: UpdateRecoveryOptions) {
  try {
    const value = await evidence(options);
    return {
      state: await state(options, value),
      operationId: options.operationId,
      lastPhase: value.records.at(-1)?.phase ?? null,
    };
  } catch {
    throw new UpdateRecoveryError();
  }
}
async function verifyOriginal(options: UpdateRecoveryOptions) {
  const envelope = JSON.parse(
    (await textFile(
      join(options.installedRoot, 'release.json'),
      2 * 1024 * 1024,
    ))!,
  );
  const manifest = parseReleaseManifest(
    JSON.parse(
      Buffer.from(
        z
          .string()
          .max(2 * 1024 * 1024)
          .parse(envelope.payload),
        'base64url',
      ).toString('utf8'),
    ),
  );
  const verified = await verifyReleasePackage(
    options.installedRoot,
    options.releaseTrust,
    {
      version: manifest.minimumInstalledVersion,
      schemaDigest: manifest.fromSchemaDigest,
    },
  );
  if (
    verified.version !== options.installed.version ||
    verified.toSchemaDigest !== options.installed.schemaDigest
  )
    throw new UpdateRecoveryError();
}

// Explicit host-only recovery. No maintenance entitlement is required to restore
// a previously installed release. Authorization/issuance gates remain unchanged.
export async function recoverFailedUpdate(
  options: UpdateRecoveryOptions,
  service: UpdateRecoveryService,
  confirmations: {
    updaterStopped: boolean;
    installationId: string;
    acceptRecoveryPoint: boolean;
  },
) {
  let stopping = false;
  let claimed = false;
  let claim: string | undefined;
  try {
    if (
      !confirmations.updaterStopped ||
      confirmations.installationId !== options.installationId ||
      !confirmations.acceptRecoveryPoint
    )
      throw new UpdateRecoveryError();
    const value = await evidence(options);
    claim = join(value.lock, 'recovery.lock');
    await mkdir(claim, { mode: 0o700 });
    await secureDirectory(claim);
    claimed = true;
    await verifyOriginal(options);
    const expectedState = await readInstallationState(options.journalParent);
    const originalState =
      expectedState.version === options.installed.version &&
      expectedState.appRoot === options.installedRoot &&
      expectedState.schemaDigest === options.installed.schemaDigest;
    const selectedState =
      value.intent &&
      expectedState.operationId === options.operationId &&
      expectedState.version === value.intent.targetVersion &&
      expectedState.appRoot === options.stagedRoot &&
      expectedState.schemaDigest ===
        (value.intent.targetSchemaDigest ?? options.installed.schemaDigest);
    if (
      expectedState.installationId !== options.installationId ||
      (!originalState && !selectedState)
    )
      throw new UpdateRecoveryError();
    const save = async (name: string, record: unknown) => {
      const file = await open(join(claim!, name + '.json'), 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(record) + '\n');
        await file.sync();
      } finally {
        await file.close();
      }
    };
    const before = await state(options, value);
    if (before === 'unknown') throw new UpdateRecoveryError();
    await save('intent', {
      operationId: options.operationId,
      installationId: options.installationId,
      state: before,
    });
    stopping = true;
    await service.stop();
    // Reinspect after stopping; a state change requires fresh operator review.
    if ((await state(options, value)) !== before)
      throw new UpdateRecoveryError();
    if (before === 'activated') {
      await switchRecovery(
        {
          ...options,
          recoveryDatabase: value.intent!.recoveryDatabase,
          confirmActiveDatabase: value.binding.database,
          confirmWritersStopped: true,
          confirmRollbackDataLoss: true,
          originalSchemaDigest: options.installed.schemaDigest,
        },
        'rollback',
      );
      if ((await state(options, value)) !== 'not_activated')
        throw new UpdateRecoveryError();
    }
    await service.restoreOriginal();
    await service.startOriginal();
    await inspectUpdateDatabase(options, async (_db, digest) => {
      if (digest !== options.installed.schemaDigest)
        throw new UpdateRecoveryError();
    });
    await assertRecoveryRuntimeReady(
      options.runtimeConnectionString,
      options.installed.schemaDigest,
    );
    await service.assertOriginalReady();
    await replaceInstallationState(options.journalParent, expectedState, {
      ...expectedState,
      version: options.installed.version,
      appRoot: options.installedRoot,
      schemaDigest: options.installed.schemaDigest,
      operationId: options.operationId,
    });
    await service.admitOriginal();
    await save('completed', {
      operationId: options.operationId,
      installationId: options.installationId,
      state: 'original_restored',
    });
    // Archive the entire exact lock with its owner and reconciliation receipts.
    // One atomic rename releases the fixed lock without deleting evidence.
    if (
      (await textFile(join(value.lock, 'owner.json'), 1024)) !== value.ownerText
    )
      throw new UpdateRecoveryError();
    await rename(
      value.lock,
      join(value.root, 'recovery-completed-' + randomUUID()),
    );
    return {
      state: 'original_restored' as const,
      operationId: options.operationId,
    };
  } catch {
    if (stopping || claimed) {
      try {
        await service.stop();
      } catch {
        /* Report no false readiness. */
      }
    }
    // Retain both locks and all copies after failure, including lost COMMIT.
    throw new UpdateRecoveryError();
  }
}
