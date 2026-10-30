import { open, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { migrationDigest } from './backup-operator.js';

export type BackupHealth = {
  healthy: boolean;
  reason:
    | 'verified'
    | 'missing'
    | 'invalid'
    | 'failed'
    | 'stale'
    | 'incompatible'
    | 'artifact_missing';
  lastSuccessAt?: string;
};

// This reports the job's last completed restore drill. It deliberately does not
// replace archive authentication or a fresh disaster-recovery restore.
export async function checkBackupHealth(
  directory: string,
  maximumAgeHours: number,
  now = new Date(),
): Promise<BackupHealth> {
  if (
    !Number.isFinite(maximumAgeHours) ||
    maximumAgeHours <= 0 ||
    maximumAgeHours > 8760 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error(
      'Specify a maximum backup age greater than zero and at most 8760 hours.',
    );
  const root = resolve(directory);
  let status: Record<string, unknown>;
  try {
    const path = join(root, 'backup-status.json');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
      return { healthy: false, reason: 'invalid' };
    const handle = await open(path, 'r');
    try {
      // Bounded read even if a different process changes the file after lstat.
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) return { healthy: false, reason: 'invalid' };
      const value: unknown = JSON.parse(
        buffer.subarray(0, bytesRead).toString('utf8'),
      );
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return { healthy: false, reason: 'invalid' };
      status = value as Record<string, unknown>;
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      healthy: false,
      reason:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'missing'
          : 'invalid',
    };
  }
  if (status.status === 'failed') return { healthy: false, reason: 'failed' };
  if (
    status.status !== 'verified' ||
    typeof status.lastSuccessAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{7})Z$/.test(
      status.lastSuccessAt,
    )
  )
    return { healthy: false, reason: 'invalid' };
  const timestamp = Date.parse(status.lastSuccessAt);
  const age = now.getTime() - timestamp;
  if (
    !Number.isFinite(timestamp) ||
    age < 0 ||
    new Date(timestamp).toISOString() !==
      status.lastSuccessAt.slice(0, 23) + 'Z'
  )
    return { healthy: false, reason: 'invalid' };
  const observation = { lastSuccessAt: status.lastSuccessAt };
  if (age >= maximumAgeHours * 3600000)
    return { healthy: false, reason: 'stale', ...observation };
  if (
    status.currentReleaseCompatible !== true ||
    status.schemaDigest !== (await migrationDigest())
  )
    return { healthy: false, reason: 'incompatible', ...observation };
  if (
    typeof status.artifact !== 'string' ||
    !/^backup-\d{8}T\d{6}Z-[a-f0-9]{32}\.gstbackup$/.test(status.artifact)
  )
    return { healthy: false, reason: 'invalid', ...observation };
  try {
    const info = await lstat(join(root, status.artifact));
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0)
      return { healthy: false, reason: 'artifact_missing', ...observation };
  } catch {
    return { healthy: false, reason: 'artifact_missing', ...observation };
  }
  return { healthy: true, reason: 'verified', ...observation };
}
