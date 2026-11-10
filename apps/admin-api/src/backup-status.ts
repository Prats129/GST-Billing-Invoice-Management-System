import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { backupReportSchema } from '@gst/contracts';
import type { BackupStatusResponse } from '@gst/contracts';

// Read a fixed, sanitized publication only. No profile, key, environment,
// archive, restore credentials or host execution access belongs to the API.
export async function readBackupStatus(
  file: string | undefined,
  now = new Date(),
): Promise<BackupStatusResponse> {
  if (!file) return { state: 'not_configured', report: null };
  try {
    if (!isAbsolute(file)) throw new Error();
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384)
      throw new Error();
    const handle = await open(file, 'r');
    let report;
    try {
      const buffer = Buffer.alloc(16385),
        { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16384) throw new Error();
      report = backupReportSchema.parse(
        JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')),
      );
    } finally {
      await handle.close();
    }
    if (Date.parse(report.checkedAt) > now.getTime()) throw new Error();
    for (const target of report.targets) {
      if (
        target.state === 'verified' &&
        (!target.lastVerifiedAt ||
          Date.parse(target.lastVerifiedAt) > now.getTime() ||
          now.getTime() - Date.parse(target.lastVerifiedAt) >=
            target.maximumAgeHours * 3600000 ||
          now.getTime() - Date.parse(report.checkedAt) >=
            target.maximumAgeHours * 3600000)
      )
        target.state = 'stale';
    }
    return { state: 'reported', report };
  } catch {
    return { state: 'unavailable', report: null };
  }
}
