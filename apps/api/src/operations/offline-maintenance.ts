import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { open, rename, lstat, readdir } from 'node:fs/promises';
import { z } from 'zod';
import { acquireUpdateJournal, recordSchema } from './update-journal.js';
import { assertPrivateDirectory } from './release-staging.js';
import { readCertificateOperationFile } from './certificate-replacement.js';
import { certificateHash } from './certificate-probe.js';

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const kind = z.enum(['uninstall', 'repair']);
const intentSchema = z
  .object({
    format: z.literal(1),
    operationId: uuid,
    installationId: uuid,
    kind,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    binding: hash,
  })
  .strict();
const ownerSchema = z
  .object({ operationId: uuid, installationId: uuid, nonce: uuid })
  .strict();
const permitSchema = z
  .object({
    operationId: uuid,
    installationId: uuid,
    token: uuid,
    actorPid: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type OfflineMaintenanceKind = z.infer<typeof kind>;
export interface OfflineMaintenanceHost {
  inspect(
    operationId?: string,
  ): Promise<{ fingerprint: string; actorAlive: boolean }>;
  run(request: {
    operationId: string;
    kind: OfflineMaintenanceKind;
    ownerSha256: string;
    permitSha256: string;
    expectedNativeSha256: string;
    replacementPermit?: string;
  }): Promise<void>;
}
export interface OfflineMaintenanceOptions {
  parent: string;
  installationId: string;
  version: string;
  binding: string;
  repairConfiguration?: unknown;
}
export async function readOfflineMaintenanceContext(
  parent: string,
  operationId: string,
) {
  uuid.parse(operationId);
  const directory = join(parent, 'gst-update-' + operationId);
  await assertPrivateDirectory(directory);
  const intent = intentSchema.parse(
    JSON.parse(
      (await bytes(join(directory, 'offline-intent.json'), 16384)).toString(
        'utf8',
      ),
    ),
  );
  if (intent.operationId !== operationId)
    throw new Error('Foreign maintenance context.');
  return {
    kind: intent.kind,
    configuration:
      intent.kind === 'repair'
        ? (JSON.parse(
            (
              await bytes(join(directory, 'repair-configuration.json'), 32768)
            ).toString('utf8'),
          ) as unknown)
        : undefined,
  };
}
async function bytes(path: string, maximum: number) {
  return readCertificateOperationFile(path, maximum);
}
async function write(path: string, value: unknown) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}
function permit(installationId: string, operationId: string) {
  return {
    installationId,
    operationId,
    token: randomUUID(),
    actorPid: process.pid,
    createdAt: new Date().toISOString(),
  };
}
async function evidence(
  options: OfflineMaintenanceOptions,
  operationId: string,
) {
  uuid.parse(operationId);
  uuid.parse(options.installationId);
  hash.parse(options.binding);
  await assertPrivateDirectory(options.parent);
  const directory = join(options.parent, 'gst-update-' + operationId),
    lock = join(options.parent, 'gst-update.lock');
  await assertPrivateDirectory(directory);
  await assertPrivateDirectory(lock);
  const ownerBytes = await bytes(join(lock, 'owner.json'), 1024),
    owner = ownerSchema.parse(JSON.parse(ownerBytes.toString('utf8')));
  if (
    owner.installationId !== options.installationId ||
    owner.operationId !== operationId
  )
    throw new Error('Foreign maintenance lock.');
  const intentBytes = await bytes(
    join(directory, 'offline-intent.json'),
    16384,
  );
  const intent = intentSchema.parse(JSON.parse(intentBytes.toString('utf8')));
  if (
    intent.installationId !== options.installationId ||
    intent.operationId !== operationId ||
    intent.binding !== options.binding ||
    intent.version !== options.version
  )
    throw new Error('Maintenance binding changed.');
  const events = await bytes(join(directory, 'events.jsonl'), 1048576);
  const lines = events.toString('utf8').split('\n');
  // Preserve a torn final record verbatim. Recovery writes a separate receipt;
  // it never truncates, repairs or appends behind a partial original journal.
  const tail = lines.pop()!;
  if (tail.length > 16384) throw new Error('Invalid journal tail.');
  const header = z
    .object({
      event: z.literal('update_journal_created'),
      operationId: uuid,
      installationId: uuid,
      recordedAt: z.string().datetime(),
      operationKind: kind,
    })
    .strict()
    .parse(JSON.parse(lines.shift()!));
  if (
    header.operationId !== operationId ||
    header.installationId !== options.installationId ||
    header.operationKind !== intent.kind
  )
    throw new Error('Wrong operation kind.');
  for (const line of lines) {
    const record = recordSchema
      .extend({ recordedAt: z.string().datetime() })
      .strict()
      .parse(JSON.parse(line));
    if (
      record.operationId !== operationId ||
      record.installationId !== options.installationId
    )
      throw new Error('Foreign journal record.');
  }
  const permitBytes = await bytes(join(directory, 'native-permit.json'), 2048);
  const current = permitSchema.parse(JSON.parse(permitBytes.toString('utf8')));
  if (
    current.operationId !== operationId ||
    current.installationId !== options.installationId
  )
    throw new Error('Wrong execution permit.');
  return {
    directory,
    lock,
    intent,
    ownerBytes,
    permitBytes,
    intentBytes,
    events,
  };
}
export async function inspectOfflineMaintenance(
  options: OfflineMaintenanceOptions,
  operationId: string,
  host: OfflineMaintenanceHost,
) {
  const value = await evidence(options, operationId);
  const native = await host.inspect(operationId);
  hash.parse(native.fingerprint);
  const fingerprint = certificateHash(
    Buffer.from(
      JSON.stringify({
        binding: options.binding,
        owner: certificateHash(value.ownerBytes),
        intent: certificateHash(value.intentBytes),
        events: certificateHash(value.events),
        permit: certificateHash(value.permitBytes),
        native: native.fingerprint,
      }),
    ),
  );
  return {
    operationId,
    kind: value.intent.kind,
    fingerprint,
    nativeSha256: native.fingerprint,
    actorAlive: native.actorAlive,
  };
}
export async function runOfflineMaintenance(
  options: OfflineMaintenanceOptions,
  action: OfflineMaintenanceKind,
  host: OfflineMaintenanceHost,
) {
  const operationId = randomUUID();
  const intent = intentSchema.parse({
    format: 1,
    operationId,
    installationId: options.installationId,
    kind: action,
    version: options.version,
    binding: options.binding,
  });
  if (action === 'repair' && options.repairConfiguration === undefined)
    throw new Error('Repair configuration required.');
  await assertPrivateDirectory(options.parent);
  const lease = await acquireUpdateJournal(
    options.parent,
    options.installationId,
    operationId,
    action,
  );
  try {
    await lease.record({
      operationId,
      installationId: options.installationId,
      version: options.version,
      phase: 'stopping',
    });
    if (action === 'repair')
      await write(
        join(lease.directory, 'repair-configuration.json'),
        options.repairConfiguration,
      );
    await write(join(lease.directory, 'offline-intent.json'), intent);
    await write(
      join(lease.directory, 'native-permit.json'),
      permit(options.installationId, operationId),
    );
    const value = await evidence(options, operationId),
      observed = await host.inspect(operationId);
    await host.run({
      operationId,
      kind: action,
      ownerSha256: certificateHash(value.ownerBytes),
      permitSha256: certificateHash(value.permitBytes),
      expectedNativeSha256: hash.parse(observed.fingerprint),
    });
    await lease.record({
      operationId,
      installationId: options.installationId,
      version: options.version,
      phase: 'completed',
    });
    return { operationId, kind: action };
  } finally {
    await lease.release();
  }
}
export async function recoverOfflineMaintenance(
  options: OfflineMaintenanceOptions,
  operationId: string,
  host: OfflineMaintenanceHost,
  confirmation: {
    installationId: string;
    operatorStopped: boolean;
    expectedFingerprint: string;
  },
) {
  if (
    confirmation.installationId !== options.installationId ||
    !confirmation.operatorStopped
  )
    throw new Error('Stop the previous operator before recovery.');
  hash.parse(confirmation.expectedFingerprint);
  const value = await evidence(options, operationId);
  const inspection = await inspectOfflineMaintenance(
    options,
    operationId,
    host,
  );
  if (
    inspection.actorAlive ||
    inspection.fingerprint !== confirmation.expectedFingerprint
  )
    throw new Error('Stale inspection or live operator.');
  // Competing claims never silently steal one another. A failed/crashed claim
  // is retained; its next explicit recovery must supply its fresh inspection.
  const claimId = randomUUID();
  const claim = await open(
    join(value.directory, 'claim-' + claimId + '.json'),
    'wx',
    0o600,
  );
  try {
    await claim.writeFile(
      JSON.stringify({ claimId, inspection, at: new Date().toISOString() }) +
        '\n',
    );
    await claim.sync();
  } finally {
    await claim.close();
  }
  await host.run({
    operationId,
    kind: value.intent.kind,
    ownerSha256: certificateHash(value.ownerBytes),
    permitSha256: certificateHash(value.permitBytes),
    expectedNativeSha256: inspection.nativeSha256,
    replacementPermit:
      JSON.stringify(permit(options.installationId, operationId)) + '\n',
  });
  // Native guard/fence has completed; recheck owner and reject unknown lock
  // contents before archiving the whole lock. Never unlink a guessed owner.
  if (
    certificateHash(await bytes(join(value.lock, 'owner.json'), 1024)) !==
    certificateHash(value.ownerBytes)
  )
    throw new Error('Lock owner changed.');
  const names = (await readdir(value.lock)).sort();
  if (names.join(',') !== 'owner.json')
    throw new Error('Unknown maintenance lock files.');
  const info = await lstat(value.lock);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Changed lock.');
  await write(join(value.directory, 'recovered-' + claimId + '.json'), {
    operationId,
    installationId: options.installationId,
    kind: value.intent.kind,
    state: 'completed',
  });
  await rename(value.lock, join(value.directory, 'resolved-lock-' + claimId));
  return { operationId, kind: value.intent.kind };
}
