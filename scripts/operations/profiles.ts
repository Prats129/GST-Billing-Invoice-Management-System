import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { Client } from '../../apps/admin-api/src/store.js';
import {
  assertPrivateDirectory,
  secureDirectory,
} from '../../apps/api/src/operations/release-staging.js';
import { saveNewFile } from '../setup/workflow.js';

const path = z
  .string()
  .min(1)
  .max(4096)
  .refine(isAbsolute, 'Use an absolute host path');
export const backupTarget = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    kind: z.enum(['billing', 'platform']),
    envFile: path,
    expectedDatabase: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{0,62}$/)
      .refine((name) => !['postgres', 'template0', 'template1'].includes(name)),
    databaseOid: z.number().int().positive(),
    cluster: z.string().regex(/^\d+$/),
    installationId: z.string().uuid(),
    keyFile: path,
    backupDirectory: path,
    workDirectory: path,
    maximumAgeHours: z.number().int().min(1).max(8760),
    tools: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('docker'),
          container: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
        })
        .strict(),
      z.object({ type: z.literal('native'), directory: path }).strict(),
    ]),
  })
  .strict();
export const backupProfile = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    recoveryKitAcknowledgedAt: z.string().datetime(),
    publicationDirectory: path.optional(),
    targets: z.array(backupTarget).min(1).max(2),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      new Set(profile.targets.map((target) => target.id)).size !==
        profile.targets.length ||
      new Set(profile.targets.map((target) => target.kind)).size !==
        profile.targets.length
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Choose at most one billing and one platform target with distinct IDs',
      });
  });
export type BackupTarget = z.infer<typeof backupTarget>;
export type BackupProfile = z.infer<typeof backupProfile>;

export async function readPrivateJson(
  file: string,
  maximum = 65536,
): Promise<unknown> {
  await assertPrivateDirectory(dirname(file));
  return JSON.parse(await readPrivateText(file, maximum)) as unknown;
}
export async function readPrivateText(file: string, maximum = 65536) {
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > maximum ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  )
    throw new Error('PRIVATE_FILE_REQUIRED');
  // Bound the actual read, not only a potentially stale stat.
  const { open } = await import('node:fs/promises');
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maximum) throw new Error('PRIVATE_FILE_TOO_LARGE');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
export async function privateDirectory(directory: string) {
  try {
    await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(directory, { mode: 0o700 });
    await secureDirectory(directory);
  }
  await assertPrivateDirectory(directory);
}
export async function loadBackupProfile(directory: string) {
  return backupProfile.parse(
    await readPrivateJson(join(resolve(directory), 'backup-profile.json')),
  );
}
export async function saveBackupProfile(
  directory: string,
  profile: BackupProfile,
) {
  backupProfile.parse(profile);
  await mkdir(directory, { mode: 0o700 });
  await secureDirectory(directory);
  await saveNewFile(
    directory,
    'backup-profile.json',
    JSON.stringify(profile, null, 2) + '\n',
  );
}
export async function targetEnvironment(target: BackupTarget) {
  await assertPrivateDirectory(dirname(target.envFile));
  return parseEnv(await readPrivateText(target.envFile));
}
export function connectionUrl(
  target: BackupTarget,
  env: Record<string, string | undefined>,
) {
  const value =
    env[
      target.kind === 'billing'
        ? 'MIGRATION_DATABASE_URL'
        : 'PLATFORM_MIGRATION_DATABASE_URL'
    ];
  if (!value) throw new Error('OPERATOR_CONNECTION_REQUIRED');
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.search ||
    url.hash ||
    decodeURIComponent(url.pathname.slice(1)) !== target.expectedDatabase
  )
    throw new Error('BACKUP_TARGET_MISMATCH');
  return url.toString();
}
export async function databaseIdentity(db: Client) {
  const result = await db.query<{ oid: number; cluster: string }>(
    'SELECT d.oid::int AS oid, (pg_control_system()).system_identifier::text AS cluster FROM pg_database d WHERE datname=current_database()',
  );
  if (!result.rows[0]) throw new Error('DATABASE_IDENTITY_UNAVAILABLE');
  return result.rows[0];
}
export function operationId() {
  return randomUUID();
}
