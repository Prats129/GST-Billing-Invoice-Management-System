import { afterEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBackupHealth } from './backup-health.js';
import { migrationDigest } from './backup-operator.js';

const roots: string[] = [];
const now = new Date('2026-10-30T10:00:00.000Z');
const artifact = 'backup-20261030T090000Z-' + 'ab'.repeat(16) + '.gstbackup';
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gst-backup-health-'));
  roots.push(root);
  const status = {
    status: 'verified',
    lastSuccessAt: '2026-10-30T09:00:00.0000000Z',
    artifact,
    currentReleaseCompatible: true,
    schemaDigest: await migrationDigest(),
  };
  await writeFile(join(root, artifact), 'encrypted-archive-fixture');
  const save = (value: unknown) =>
    writeFile(join(root, 'backup-status.json'), JSON.stringify(value));
  await save(status);
  return { root, status, save };
}
test('a recent compatible completed drill with an existing artifact is healthy', async () => {
  const f = await fixture();
  expect(await checkBackupHealth(f.root, 24, now)).toEqual({
    healthy: true,
    reason: 'verified',
    lastSuccessAt: f.status.lastSuccessAt,
  });
});
test('a failure is visible even when a previous backup succeeded recently', async () => {
  const f = await fixture();
  await f.save({ ...f.status, status: 'failed' });
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    healthy: false,
    reason: 'failed',
  });
});
test('maximum age is an explicit boundary and future timestamps fail closed', async () => {
  const f = await fixture();
  expect(await checkBackupHealth(f.root, 1, now)).toMatchObject({
    healthy: false,
    reason: 'stale',
  });
  await f.save({ ...f.status, lastSuccessAt: '2026-10-31T09:00:00.000Z' });
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    healthy: false,
    reason: 'invalid',
  });
  for (const age of [0, -1, Infinity, NaN, 8761])
    await expect(checkBackupHealth(f.root, age, now)).rejects.toThrow();
});
test('missing, malformed and oversized status cannot claim success', async () => {
  const f = await fixture();
  await rm(join(f.root, 'backup-status.json'));
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    reason: 'missing',
  });
  for (const value of [
    null,
    [],
    {},
    { ...f.status, lastSuccessAt: 'October 30' },
  ]) {
    await f.save(value);
    expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
      healthy: false,
      reason: 'invalid',
    });
  }
  await writeFile(join(f.root, 'backup-status.json'), ' '.repeat(4097));
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    reason: 'invalid',
  });
});
test('old-schema restores and absent artifacts require operator attention', async () => {
  const f = await fixture();
  await f.save({ ...f.status, currentReleaseCompatible: false });
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    reason: 'incompatible',
  });
  await f.save({ ...f.status, schemaDigest: 'ab'.repeat(32) });
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    reason: 'incompatible',
  });
  await f.save(f.status);
  await rm(join(f.root, artifact));
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    reason: 'artifact_missing',
  });
  await f.save({ ...f.status, artifact: '../outside.gstbackup' });
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    reason: 'invalid',
  });
});
test('a directory junction cannot substitute for a verified artifact', async () => {
  const f = await fixture();
  await rm(join(f.root, artifact));
  await symlink(
    f.root,
    join(f.root, artifact),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect(await checkBackupHealth(f.root, 24, now)).toMatchObject({
    reason: 'artifact_missing',
  });
});
