import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Client } from '../../apps/admin-api/src/store.js';
import {
  saveBackupProfile,
  loadBackupProfile,
  backupProfile,
  backupTarget,
  targetEnvironment,
  connectionUrl,
  databaseIdentity,
} from './profiles.js';
import type { BackupTarget } from './profiles.js';
import {
  runBackupJob,
  backupStatus,
  publishBackupStatus,
  acknowledgeInterruptedJob,
  artifactFileName,
} from './runner.js';
import { saveNewFile } from '../setup/workflow.js';
import { copyVerifiedArchive } from './artifacts.js';
import {
  billingRecoveryAction,
  reconcilePlatformRecovery,
  recoveryInventory,
} from './recovery.js';

// The assistant selects fixed host functions. It never executes a supplied
// command, shell fragment, SQL statement or executable from a browser.
let terminal: ReturnType<typeof createInterface> | undefined;
async function ask(label: string, fallback = '') {
  const value =
    (
      await terminal!.question(
        label + (fallback ? ' [' + fallback + ']' : '') + ': ',
      )
    ).trim() || fallback;
  if (
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error('INVALID_INPUT');
  return value;
}
async function confirm(message: string, expected = 'YES') {
  if ((await ask(message + ' Type ' + expected)) !== expected)
    throw new Error('CANCELLED');
}
async function initialize() {
  const directory = resolve(
    await ask(
      'NEW protected backup profile folder (existing folders are refused)',
    ),
  );
  const kinds = await ask('Protect billing, platform or both', 'both');
  if (!['billing', 'platform', 'both'].includes(kinds))
    throw new Error('INVALID_SELECTION');
  const targets: BackupTarget[] = [],
    newKeys: string[] = [];
  for (const kind of (kinds === 'both' ? ['billing', 'platform'] : [kinds]) as (
    'billing' | 'platform'
  )[]) {
    console.log(
      '\nConfigure ' +
        kind +
        '. Credentials stay in an existing protected operator environment file.',
    );
    const envFile = resolve(await ask('Private operator environment file'));
    const expectedDatabase = await ask('Independently verified database name');
    const keyMode = await ask(
      'Reuse an existing backup key/identity or create a FIRST key? (reuse/new)',
      'reuse',
    );
    if (!['reuse', 'new'].includes(keyMode))
      throw new Error('INVALID_SELECTION');
    let installationId: string, keyFile: string;
    if (keyMode === 'new') {
      await confirm(
        'Only for first backup setup. A new key CANNOT recover existing archives. Confirm no existing backup identity is being replaced.',
      );
      installationId = randomUUID();
      keyFile = join(directory, kind + '.key');
      newKeys.push(keyFile);
    } else {
      keyFile = resolve(await ask('Existing private 32-byte backup key file'));
      installationId = await ask(
        'Existing backup installation UUID (do not invent a replacement)',
      );
    }
    const backupDirectory = resolve(
      await ask('Private encrypted backup directory (parent must exist)'),
    );
    const workDirectory = resolve(
      await ask(
        'Private temporary-work directory on encrypted local disk (parent must exist)',
      ),
    );
    const maximumAgeHours = Number(
      await ask('Maximum verified-backup age in hours (choose your policy)'),
    );
    const type = await ask(
      'Approved PostgreSQL 18 tools: native or local development docker',
      'native',
    );
    const tools =
      type === 'docker'
        ? {
            type: 'docker' as const,
            container: await ask('Local PostgreSQL container name'),
          }
        : type === 'native'
          ? {
              type: 'native' as const,
              directory: resolve(
                await ask('Approved PostgreSQL 18 bin directory'),
              ),
            }
          : null;
    if (!tools) throw new Error('INVALID_SELECTION');
    let target = backupTarget.parse({
      id: kind,
      kind,
      envFile,
      expectedDatabase,
      databaseOid: 1,
      cluster: '1',
      installationId,
      keyFile,
      backupDirectory,
      workDirectory,
      maximumAgeHours,
      tools,
    });
    const env = await targetEnvironment(target);
    const db = new Client({
      connectionString: connectionUrl(target, env),
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    try {
      await db.connect();
      const identity = await databaseIdentity(db);
      target = {
        ...target,
        databaseOid: identity.oid,
        cluster: identity.cluster,
      };
    } finally {
      await db.end();
    }
    targets.push(target);
  }
  console.log(
    'Review: ' +
      targets
        .map(
          (target) =>
            target.kind +
            ' → ' +
            target.expectedDatabase +
            ', max age ' +
            target.maximumAgeHours +
            'h',
        )
        .join('; '),
  );
  console.log(
    'Recovery needs the original MFA/authentication encryption keys, private runtime configuration, recovery proofs, and separate publisher register/trust custody. A database backup alone is insufficient.',
  );
  await confirm(
    'Confirm a protected off-device recovery-kit procedure and storage are prepared; keep keys separate from archives. No automatic pruning or live restore will run.',
  );
  const publication = await ask(
    'Separate sanitized status-publication folder (leave empty for host-only status)',
  );
  const profile = backupProfile.parse({
    version: 1,
    id: randomUUID(),
    recoveryKitAcknowledgedAt: new Date().toISOString(),
    targets,
    ...(publication ? { publicationDirectory: resolve(publication) } : {}),
  });
  await saveBackupProfile(directory, profile);
  for (const keyFile of newKeys) {
    const key = randomBytes(32),
      handle = await open(keyFile, 'wx', 0o600);
    try {
      await handle.writeFile(key);
      await handle.sync();
    } finally {
      key.fill(0);
      await handle.close();
    }
  }
  console.log(
    'Profile saved. Preserve its original identity and key files in protected off-device custody before relying on backups. Do not share the profile or operator configuration.',
  );
}
try {
  const args = process.argv.slice(2);
  if (args[0] === 'run') {
    // Fixed noninteractive entry point for an approved host scheduler.
    if (args.length !== 3)
      throw new Error('Usage: backup:guided run <profile-folder> <target-id>');
    const result = await runBackupJob(
      resolve(args[1]!),
      args[2]!,
      'backup',
      undefined,
      (phase) =>
        console.log(JSON.stringify({ event: 'backup_progress', phase })),
    );
    console.log(JSON.stringify({ event: 'backup_verified', id: result.id }));
  } else {
    if (args.length || !process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error('INTERACTIVE_TERMINAL_REQUIRED');
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 0,
    });
    terminal.on('SIGINT', () => {
      terminal?.close();
      process.exitCode = 1;
    });
    const action = await ask(
      'Action: init, status, backup, verify, recover, export, inspect, reconcile, runtime-grants, cutover-status, activate, rollback, acknowledge-interrupted, publish',
      'status',
    );
    if (action === 'init') await initialize();
    else {
      const directory = resolve(await ask('Protected backup profile folder'));
      const profile = await loadBackupProfile(directory);
      if (action === 'status')
        console.log(JSON.stringify(await backupStatus(directory), null, 2));
      else if (action === 'publish') {
        const destination = resolve(
          await ask(
            'Dedicated status-publication folder (never the key/profile folder)',
          ),
        );
        if (
          destination === directory ||
          directory.startsWith(destination + '\\') ||
          directory.startsWith(destination + '/') ||
          destination.startsWith(directory + '\\') ||
          destination.startsWith(directory + '/')
        )
          throw new Error('SEPARATE_PUBLICATION_DIRECTORY_REQUIRED');
        console.log(
          JSON.stringify(
            await publishBackupStatus(directory, destination),
            null,
            2,
          ),
        );
      } else {
        const targetId = await ask(
          'Target ID: ' + profile.targets.map((target) => target.id).join(', '),
        );
        const target = profile.targets.find((item) => item.id === targetId);
        if (!target) throw new Error('UNKNOWN_BACKUP_TARGET');
        if (action === 'inspect')
          console.log(
            JSON.stringify(
              await recoveryInventory(directory, targetId),
              null,
              2,
            ),
          );
        else if (action === 'reconcile') {
          const jobId = await ask('Completed platform recovery job UUID');
          console.log(
            JSON.stringify(
              await reconcilePlatformRecovery(directory, targetId, jobId),
              null,
              2,
            ),
          );
        } else if (
          ['runtime-grants', 'cutover-status', 'activate', 'rollback'].includes(
            action,
          )
        ) {
          if (target.kind !== 'billing')
            throw new Error(
              'Platform cutover requires the reviewed host procedure after reconciliation; worker authority stays disabled.',
            );
          const jobId = await ask('Completed billing recovery job UUID');
          const runtimeFile = resolve(
            await ask(
              'Protected BILLING runtime environment file (no migration role)',
            ),
          );
          const runtime = await targetEnvironment({
            ...target,
            envFile: runtimeFile,
          });
          if (!runtime.DATABASE_URL)
            throw new Error('RUNTIME_CONNECTION_REQUIRED');
          if (action !== 'cutover-status')
            await confirm(
              'Confirm the active database being reviewed',
              target.expectedDatabase,
            );
          const mutates = action === 'activate' || action === 'rollback';
          if (mutates) {
            await confirm(
              'All applications, services, workers and scheduled writers for this database are stopped and the recovery point/configuration keys have been independently reviewed.',
            );
            if (action === 'rollback')
              await confirm(
                'Rollback discards access to writes made after cutover. I accept the reviewed data loss and will retain both databases.',
              );
          }
          console.log(
            JSON.stringify(
              await billingRecoveryAction(
                directory,
                targetId,
                jobId,
                action === 'cutover-status'
                  ? 'status'
                  : (action as 'runtime-grants' | 'activate' | 'rollback'),
                runtime.DATABASE_URL,
                mutates,
                action === 'rollback',
              ),
              null,
              2,
            ),
          );
          console.log(
            'Inspect switch status after ANY uncertain response. Keep both database copies; do not restart until host validation passes. An OID change requires an explicitly reviewed new backup profile reusing the original key/installation identity.',
          );
        } else if (action === 'acknowledge-interrupted') {
          const id = await ask(
            'Interrupted job UUID (inspect its planned candidate and archive first)',
          );
          await confirm(
            'I inspected the source, any planned recovery database, archive and protected workspace. Keep unresolved artifacts; this only records interruption.',
          );
          await acknowledgeInterruptedJob(directory, targetId, id);
        } else if (['backup', 'verify', 'recover', 'export'].includes(action)) {
          const artifact =
            action === 'backup'
              ? undefined
              : artifactFileName(
                  await ask(
                    'Recorded archive filename (use inspect to find it)',
                  ),
                );
          if (action === 'recover')
            await confirm(
              'Prepare a NEW quarantined recovery copy only; the active database stays unchanged. Confirm the installation UUID',
              target.installationId,
            );
          if (action === 'export') {
            // Verify again before export. Only encrypted archives cross this boundary.
            const verified = await runBackupJob(
              directory,
              targetId,
              'verify',
              artifact,
              (phase) =>
                console.log('Backup step: ' + phase.replaceAll('_', ' ')),
            );
            const destination = resolve(
              await ask(
                'Off-device export folder (existing, unlocked storage)',
              ),
            );
            await copyVerifiedArchive(
              join(target.backupDirectory, artifact!),
              destination,
              verified.artifactSha256,
            );
            await saveNewFile(
              directory,
              'export-' + randomUUID() + '.json',
              JSON.stringify({
                target: targetId,
                artifact,
                exportedAt: new Date().toISOString(),
                verifiedEncryptedCopy: true,
              }) + '\n',
            );
            console.log(
              'Encrypted copy exported without replacing an existing file. Keys/configuration were not copied.',
            );
          } else
            console.log(
              JSON.stringify(
                await runBackupJob(
                  directory,
                  targetId,
                  action as 'backup' | 'verify' | 'recover',
                  artifact,
                  (phase) =>
                    console.log('Backup step: ' + phase.replaceAll('_', ' ')),
                ),
                null,
                2,
              ),
            );
        } else throw new Error('INVALID_SELECTION');
      }
    }
  }
} catch (error) {
  // Never print driver/Zod/file errors: they may contain credentials or private paths.
  const guidance: Record<string, string> = {
    CANCELLED:
      'Cancelled. No further steps will run; retain any already prepared profile/evidence.',
    INTERACTIVE_TERMINAL_REQUIRED:
      'Open a real PowerShell terminal and run pnpm backup:guided, or use the fixed run command for an approved schedule.',
    INTERRUPTED_JOB_REQUIRES_INSPECTION:
      'A previous job has no confirmed outcome. Use inspect, review its planned candidate/archive, then acknowledge-interrupted before a new job.',
    BACKUP_ALREADY_RUNNING:
      'Another host backup/recovery job holds this database lock. Wait for it to finish; do not delete locks or start another profile.',
    DATABASE_IDENTITY_MISMATCH:
      'The PostgreSQL cluster or database OID changed. Stop and review the restore/cutover history. Do not rewrite the old profile to hide the mismatch.',
    BACKUP_TARGET_MISMATCH:
      'The operator environment does not match the confirmed loopback database. Correct its target before running jobs.',
    SEPARATE_PUBLICATION_DIRECTORY_REQUIRED:
      'Choose a separate status folder. The admin runtime must never receive access to backup profiles, keys, environments or archives.',
    OPERATOR_CONNECTION_REQUIRED:
      'The protected environment needs the appropriate migration/backup connection. Runtime credentials are not sufficient.',
    RECONCILIATION_LIMIT_REQUIRES_OPERATOR_REVIEW:
      'History exceeds the bounded reconciliation report. Keep processing disabled and arrange a reviewed full host reconciliation.',
  };
  const message = error instanceof Error ? guidance[error.message] : undefined;
  console.error(
    message ??
      'Backup workflow stopped. Check the private profile, original key/identity, approved tools, disk space and database permissions. Inspect saved jobs/candidates before retrying an unknown outcome. Existing databases, keys and archives must not be reset.',
  );
  process.exitCode = 1;
} finally {
  terminal?.close();
}
