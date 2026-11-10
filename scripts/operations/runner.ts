import {
  lstat,
  readdir,
  readFile,
  open,
  rename,
  unlink,
} from 'node:fs/promises';
import { fileHash } from './artifacts.js';
import {
  join,
  basename,
  resolve,
  relative,
  isAbsolute,
  sep,
  dirname,
} from 'node:path';
import { z } from 'zod';
import { Client } from '../../apps/admin-api/src/store.js';
import {
  createEncryptedBackup,
  verifyRestore,
  prepareRecovery,
  migrationDigest,
} from '../../packages/database/src/backup-operator.js';
import type { BackupOperatorOptions } from '../../packages/database/src/backup-operator.js';
import {
  backupReportSchema,
  backupFailureSchema,
} from '../../packages/contracts/src/backup.js';
import { BackupError } from '../../packages/database/src/backup-artifact.js';
import type { BackupReport } from '../../packages/contracts/src/backup.js';
import { assertPrivateDirectory } from '../../apps/api/src/operations/release-staging.js';
import { saveNewFile } from '../setup/workflow.js';
import {
  loadBackupProfile,
  targetEnvironment,
  connectionUrl,
  databaseIdentity,
  privateDirectory,
  operationId,
  readPrivateText,
} from './profiles.js';
import type { BackupTarget } from './profiles.js';
import { platformBackupAdapter } from './platform.js';

const recordSchema = z
  .object({
    id: z.string().uuid(),
    target: z.string(),
    action: z.enum(['backup', 'verify', 'recover']),
    startedAt: z.string().datetime(),
    artifact: z
      .string()
      .regex(/^backup-[a-f0-9-]{36}\.(gstbackup|gstplatformbackup)$/),
  })
  .strict();
const receiptSchema = z
  .object({
    finishedAt: z.string().datetime(),
    state: z.enum(['completed', 'failed', 'interrupted']),
    schemaDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    artifactSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    recoveryDatabase: z
      .string()
      .regex(/^gst_(platform_)?recovery_[a-f0-9]{32}$/)
      .optional(),
    errorCode: backupFailureSchema.optional(),
  })
  .strict();
type Record = z.infer<typeof recordSchema>;
export function backupFailureCode(
  error: unknown,
): z.infer<typeof backupFailureSchema> {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  if (code === 'ENOSPC') return 'STORAGE_FULL';
  if (['EACCES', 'EPERM'].includes(code)) return 'ACCESS_DENIED';
  if (code === 'EEXIST') return 'EXISTING_ARTIFACT';
  if (code.startsWith('08') || ['ECONNREFUSED', 'ETIMEDOUT'].includes(code))
    return 'DATABASE_UNAVAILABLE';
  if (error instanceof BackupError)
    return /tool|PostgreSQL 18/.test(error.message)
      ? 'TOOLS_FAILED'
      : 'ARCHIVE_REJECTED';
  return 'VERIFICATION_FAILED';
}
async function records(directory: string, target: string) {
  const names = (await readdir(directory)).filter((name) =>
    /^job-[a-f0-9-]{36}\.json$/.test(name),
  );
  if (names.length > 10000) throw new Error('JOB_INVENTORY_LIMIT');
  const jobs: Record[] = [];
  for (const name of names) {
    const record = recordSchema.parse(
      JSON.parse(await readPrivateText(join(directory, name))),
    );
    if (name !== 'job-' + record.id + '.json')
      throw new Error('JOB_IDENTITY_MISMATCH');
    if (record.target === target) jobs.push(record);
  }
  return jobs.sort(
    (a, b) =>
      b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
  );
}
async function receipt(directory: string, id: string) {
  try {
    return receiptSchema.parse(
      JSON.parse(
        await readPrivateText(join(directory, 'result-' + id + '.json')),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function withTarget<T>(
  target: BackupTarget,
  action: (db: Client, options: BackupOperatorOptions) => Promise<T>,
) {
  const env = await targetEnvironment(target);
  const url = connectionUrl(target, env),
    db = new Client({
      connectionString: url,
      connectionTimeoutMillis: 5000,
      statement_timeout: 60000,
    });
  let key: Buffer | undefined;
  try {
    await db.connect();
    const identity = await databaseIdentity(db);
    if (
      identity.oid !== target.databaseOid ||
      identity.cluster !== target.cluster
    )
      throw new Error('DATABASE_IDENTITY_MISMATCH');
    const locked = await db.query(
      "SELECT pg_try_advisory_lock(hashtextextended('gst-backup:'||current_database(),73492640)) AS locked",
    );
    if (!locked.rows[0]?.locked) throw new Error('BACKUP_ALREADY_RUNNING');
    await assertPrivateDirectory(dirname(target.keyFile));
    const info = await lstat(target.keyFile);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size !== 32 ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    )
      throw new Error('BACKUP_KEY_INVALID');
    key = await readFile(target.keyFile);
    await privateDirectory(target.backupDirectory);
    await privateDirectory(target.workDirectory);
    const options: BackupOperatorOptions = {
      connectionString: url,
      installationId: target.installationId,
      key,
      workDirectory: target.workDirectory,
      ...(target.tools.type === 'docker'
        ? { dockerContainer: target.tools.container }
        : { pgBinDirectory: target.tools.directory }),
      ...(target.kind === 'platform'
        ? { databaseAdapter: await platformBackupAdapter() }
        : {}),
    };
    return await action(db, options);
  } finally {
    key?.fill(0);
    await db.end();
  }
}
export async function runBackupJob(
  directory: string,
  targetId: string,
  action: Record['action'],
  artifactName?: string,
  progress: (
    phase:
      | 'checking_source'
      | 'creating_archive'
      | 'verifying_restore'
      | 'preparing_recovery'
      | 'recording_result',
  ) => void = () => {},
) {
  progress('checking_source');
  directory = resolve(directory);
  const profile = await loadBackupProfile(directory),
    target = profile.targets.find((value) => value.id === targetId);
  if (!target) throw new Error('UNKNOWN_BACKUP_TARGET');
  try {
    return await withTarget(target, async (_db, options) => {
      const jobs = await records(directory, target.id);
      for (const job of jobs)
        if (!(await receipt(directory, job.id)))
          throw new Error('INTERRUPTED_JOB_REQUIRES_INSPECTION');
      const id = operationId();
      const artifact =
        action === 'backup'
          ? 'backup-' +
            id +
            (target.kind === 'platform' ? '.gstplatformbackup' : '.gstbackup')
          : artifactName;
      const job = recordSchema.parse({
        id,
        target: target.id,
        action,
        artifact,
        startedAt: new Date().toISOString(),
      });
      if (
        !job.artifact.endsWith(
          target.kind === 'platform' ? '.gstplatformbackup' : '.gstbackup',
        )
      )
        throw new Error('BACKUP_DOMAIN_MISMATCH');
      await saveNewFile(
        directory,
        'job-' + id + '.json',
        JSON.stringify(job) + '\n',
      );
      const path = join(target.backupDirectory, job.artifact);
      try {
        let outcome: object;
        if (action === 'backup') {
          progress('creating_archive');
          await createEncryptedBackup(options, path);
          progress('verifying_restore');
          outcome = await verifyRestore(options, path);
        } else {
          progress(
            action === 'verify' ? 'verifying_restore' : 'preparing_recovery',
          );
          const info = await lstat(path);
          if (!info.isFile() || info.isSymbolicLink())
            throw new Error('ARCHIVE_FILE_REQUIRED');
          outcome =
            action === 'verify'
              ? await verifyRestore(options, path)
              : await prepareRecovery(
                  {
                    ...options,
                    onRecoveryPlanned: async (database) => {
                      await saveNewFile(
                        directory,
                        'candidate-' + id + '.json',
                        JSON.stringify({
                          operationId: id,
                          recoveryDatabase: database,
                          installationId: target.installationId,
                        }) + '\n',
                      );
                    },
                  },
                  path,
                  target.installationId,
                );
        }
        const result = outcome as {
          schemaDigest: string;
          recoveryDatabase?: string;
        };
        progress('recording_result');
        const completed = receiptSchema.parse({
          finishedAt: new Date().toISOString(),
          state: 'completed',
          schemaDigest: result.schemaDigest,
          artifactSha256: await fileHash(path),
          ...(result.recoveryDatabase
            ? { recoveryDatabase: result.recoveryDatabase }
            : {}),
        });
        await saveNewFile(
          directory,
          'result-' + id + '.json',
          JSON.stringify(completed) + '\n',
        );
        return { id, artifactSha256: completed.artifactSha256!, ...outcome };
      } catch (error) {
        // Keep source/archives/candidate evidence. A partial candidate is inspected,
        // never inferred absent from a transport failure or removed by this runner.
        await saveNewFile(
          directory,
          'result-' + id + '.json',
          JSON.stringify({
            finishedAt: new Date().toISOString(),
            state: 'failed',
            errorCode: backupFailureCode(error),
          }) + '\n',
        );
        throw new Error('BACKUP_JOB_FAILED_INSPECT_EVIDENCE', {
          // eslint-disable-next-line preserve-caught-error -- Raw driver/tool causes can contain credentials; retain only the safe category.
          cause: backupFailureCode(error),
        });
      }
    });
  } finally {
    if (profile.publicationDirectory)
      await publishBackupStatus(directory, profile.publicationDirectory);
  }
}
export async function backupStatus(directory: string): Promise<BackupReport> {
  directory = resolve(directory);
  const profile = await loadBackupProfile(directory),
    now = new Date(),
    targets: BackupReport['targets'] = [];
  for (const target of profile.targets) {
    const jobs = await records(directory, target.id),
      latest = jobs[0];
    let state: BackupReport['targets'][number]['state'] = 'missing',
      lastVerifiedAt: string | null = null;
    const newest = latest ? await receipt(directory, latest.id) : null;
    if (latest)
      state = !newest
        ? 'interrupted'
        : newest.state === 'completed'
          ? 'missing'
          : newest.state === 'interrupted'
            ? 'interrupted'
            : 'failed';
    for (const job of jobs) {
      if (job.action === 'recover') continue;
      const done = await receipt(directory, job.id);
      if (done?.state !== 'completed') continue;
      lastVerifiedAt = done.finishedAt;
      // A failed/interrupted later attempt is never hidden behind old success.
      if (state === 'failed' || state === 'interrupted') break;
      const expected =
        target.kind === 'platform'
          ? (await platformBackupAdapter()).schemaDigest
          : await migrationDigest();
      if (done.schemaDigest !== expected) state = 'incompatible';
      else if (
        Date.parse(done.finishedAt) > now.getTime() ||
        now.getTime() - Date.parse(done.finishedAt) >=
          target.maximumAgeHours * 3600000
      )
        state = 'stale';
      else {
        try {
          const path = join(target.backupDirectory, job.artifact),
            info = await lstat(path);
          state =
            !info.isFile() || info.isSymbolicLink()
              ? 'artifact_missing'
              : (await fileHash(path)) === done.artifactSha256
                ? 'verified'
                : 'artifact_changed';
        } catch {
          state = 'artifact_missing';
        }
      }
      break;
    }
    targets.push({
      id: target.id,
      kind: target.kind,
      state,
      maximumAgeHours: target.maximumAgeHours,
      lastAttemptAt: latest?.startedAt ?? null,
      lastVerifiedAt,
      lastErrorCode: newest?.errorCode ?? null,
    });
  }
  return backupReportSchema.parse({
    version: 1,
    checkedAt: now.toISOString(),
    targets,
  });
}
export async function publishBackupStatus(
  directory: string,
  publicationDirectory: string,
) {
  const profile = await loadBackupProfile(directory);
  const inside = (root: string, path: string) => {
    const part = relative(resolve(root), resolve(path));
    return (
      part === '' ||
      (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part))
    );
  };
  if (
    inside(directory, publicationDirectory) ||
    inside(publicationDirectory, directory) ||
    profile.targets.some((target) =>
      [
        target.keyFile,
        target.envFile,
        target.backupDirectory,
        target.workDirectory,
      ].some((path) => inside(publicationDirectory, path)),
    )
  )
    throw new Error('SEPARATE_PUBLICATION_DIRECTORY_REQUIRED');
  const report = await backupStatus(directory);
  // Dedicated status directory can be granted read-only to the admin runtime.
  // Never give it access to the private profile/key/operator environment folder.
  await privateDirectory(publicationDirectory);
  const temporary = join(publicationDirectory, '.status-' + operationId());
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(report) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, join(publicationDirectory, 'backup-status.json'));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return report;
}
export async function inspectJobs(directory: string, targetId: string) {
  const profile = await loadBackupProfile(directory);
  if (!profile.targets.some((target) => target.id === targetId))
    throw new Error('UNKNOWN_BACKUP_TARGET');
  return Promise.all(
    (await records(directory, targetId)).map(async (job) => ({
      ...job,
      result: await receipt(directory, job.id),
    })),
  );
}
export async function acknowledgeInterruptedJob(
  directory: string,
  targetId: string,
  id: string,
) {
  const profile = await loadBackupProfile(directory),
    target = profile.targets.find((value) => value.id === targetId);
  if (!target) throw new Error('UNKNOWN_BACKUP_TARGET');
  return withTarget(target, async () => {
    const job = (await records(directory, targetId)).find(
      (value) => value.id === id,
    );
    if (!job || (await receipt(directory, id)))
      throw new Error('INTERRUPTED_JOB_NOT_FOUND');
    await saveNewFile(
      directory,
      'result-' + id + '.json',
      JSON.stringify({
        finishedAt: new Date().toISOString(),
        state: 'interrupted',
      }) + '\n',
    );
  });
}
export function artifactFileName(value: string) {
  if (
    basename(value) !== value ||
    !/^backup-[a-f0-9-]{36}\.(gstbackup|gstplatformbackup)$/.test(value)
  )
    throw new Error('SELECT_RECORDED_ARCHIVE_NAME');
  return value;
}
