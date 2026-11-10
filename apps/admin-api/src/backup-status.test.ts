import { test, expect } from 'vitest';
import {
  mkdtemp,
  writeFile,
  rm,
  mkdir,
  readFile,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBackupStatus } from './backup-status.js';
import {
  backupTarget,
  connectionUrl,
} from '../../../scripts/operations/profiles.js';
import {
  artifactFileName,
  backupFailureCode,
} from '../../../scripts/operations/runner.js';
import {
  copyVerifiedArchive,
  fileHash,
} from '../../../scripts/operations/artifacts.js';

test('backup publication is bounded, strict, read-only and fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gst-status-')),
    file = join(directory, 'status.json');
  const now = new Date('2026-11-08T12:00:00.000Z');
  try {
    expect(await readBackupStatus(undefined, now)).toEqual({
      state: 'not_configured',
      report: null,
    });
    expect((await readBackupStatus(file, now)).state).toBe('unavailable');
    const target = {
      id: 'billing',
      kind: 'billing',
      state: 'verified',
      maximumAgeHours: 24,
      lastAttemptAt: '2026-11-08T11:00:00.000Z',
      lastVerifiedAt: '2026-11-08T11:01:00.000Z',
    };
    const report = {
      version: 1,
      checkedAt: '2026-11-08T11:05:00.000Z',
      targets: [target],
    };
    await writeFile(file, JSON.stringify(report));
    expect((await readBackupStatus(file, now)).report?.targets[0]?.state).toBe(
      'verified',
    );
    expect(
      (await readBackupStatus(file, new Date('2026-11-09T12:00:00.000Z')))
        .report?.targets[0]?.state,
    ).toBe('stale');
    await writeFile(
      file,
      JSON.stringify({
        ...report,
        targets: [{ ...target, key: 'never-return' }],
      }),
    );
    expect(await readBackupStatus(file, now)).toEqual({
      state: 'unavailable',
      report: null,
    });
    await writeFile(file, ' '.repeat(17000));
    expect((await readBackupStatus(file, now)).state).toBe('unavailable');
    await writeFile(
      file,
      JSON.stringify({ ...report, checkedAt: '2099-01-01T00:00:00.000Z' }),
    );
    expect((await readBackupStatus(file, now)).state).toBe('unavailable');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('backup profiles reject arbitrary executors and mismatched targets; artifact selectors cannot traverse', () => {
  expect(
    backupTarget.safeParse({ tools: { type: 'shell', command: 'anything' } })
      .success,
  ).toBe(false);
  const target = {
    kind: 'billing',
    expectedDatabase: 'gst_test',
  } as Parameters<typeof connectionUrl>[0];
  expect(() =>
    connectionUrl(target, {
      MIGRATION_DATABASE_URL:
        'postgresql://operator:secret@127.0.0.1/gst_wrong',
    }),
  ).toThrow('BACKUP_TARGET_MISMATCH');
  expect(() =>
    connectionUrl(target, {
      MIGRATION_DATABASE_URL:
        'postgresql://operator:secret@example.com/gst_test',
    }),
  ).toThrow('BACKUP_TARGET_MISMATCH');
  expect(() => artifactFileName('../archive.gstbackup')).toThrow();
  expect(
    backupFailureCode({
      code: 'ENOSPC',
      message: 'credential-bearing-driver-details',
    }),
  ).toBe('STORAGE_FULL');
  expect(
    backupFailureCode(new Error('postgresql://private:secret@localhost/db')),
  ).toBe('VERIFICATION_FAILED');
});
test('off-device export matches the verified digest and never overwrites or publishes partial files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gst-export-')),
    destination = join(directory, 'destination');
  const name = 'backup-00000000-0000-4000-8000-000000000000.gstplatformbackup',
    source = join(directory, name);
  try {
    await mkdir(destination);
    await writeFile(source, 'encrypted fixture bytes');
    const digest = await fileHash(source);
    await expect(
      copyVerifiedArchive(source, destination, '0'.repeat(64)),
    ).rejects.toThrow('EXPORT_CHECKSUM_MISMATCH');
    expect(await readdir(destination)).toEqual([]);
    await copyVerifiedArchive(source, destination, digest);
    expect(await readFile(join(destination, name), 'utf8')).toBe(
      'encrypted fixture bytes',
    );
    await expect(
      copyVerifiedArchive(source, destination, digest),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readdir(destination)).toEqual([name]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
