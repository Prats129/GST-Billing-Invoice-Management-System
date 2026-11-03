import { afterEach, expect, test, vi } from 'vitest';
import { generateKeyPairSync, randomUUID, sign, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { secureDirectory } from './release-staging.js';
import { acquireUpdateJournal } from './update-journal.js';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { inspectFailedUpdate, recoverFailedUpdate } from './update-recovery.js';
import { readInstallationState } from './installation-state.js';
import type * as DatabaseOperations from '@gst/database/operations';
import type * as DatabaseModule from '@gst/database';

const hook = vi.hoisted(() => ({
  activated: true,
  unknown: false,
  lostReply: false,
  calls: 0,
}));
vi.mock('@gst/database/operations', async (original) => ({
  ...(await original<typeof DatabaseOperations>()),
  recoverySwitchStatus: async () => ({
    databases: hook.unknown
      ? [{ name: 'gst_fixture', oid: 999, open: true, owned: true }]
      : hook.activated
        ? [
            { name: 'gst_fixture', oid: 2, open: true, owned: true },
            {
              name: 'gst_previous_' + 'a'.repeat(32),
              oid: 1,
              open: false,
              owned: true,
            },
          ]
        : [
            { name: 'gst_fixture', oid: 1, open: true, owned: true },
            {
              name: 'gst_recovery_' + 'a'.repeat(32),
              oid: 2,
              open: false,
              owned: true,
            },
          ],
  }),
  switchRecovery: async () => {
    hook.calls++;
    hook.activated = false;
    if (hook.lostReply) throw new Error('Lost COMMIT reply');
  },
  inspectUpdateDatabase: async (
    _value: unknown,
    inspect: (db: unknown, digest: string) => unknown,
  ) => inspect({}, 'a'.repeat(64)),
}));
vi.mock('@gst/database', async (original) => ({
  ...(await original<typeof DatabaseModule>()),
  createDatabase: () => ({ ready: async () => {}, close: async () => {} }),
}));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trust = loadEntitlementTrust({
  test: publicKey.export({ type: 'spki', format: 'pem' }),
});
const parent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(parent) ||
      !basename(root).startsWith('gst-recovery-test-')
    )
      throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  Object.assign(hook, {
    activated: true,
    unknown: false,
    lostReply: false,
    calls: 0,
  });
  const root = await mkdtemp(join(parent, 'gst-recovery-test-'));
  roots.push(root);
  await secureDirectory(root);
  const operationId = randomUUID(),
    installationId = randomUUID();
  const installedRoot = join(root, 'original'),
    stagedRoot = join(root, 'candidate');
  await mkdir(installedRoot);
  await mkdir(stagedRoot);
  const body = 'original signed fixture; never execute';
  await writeFile(join(installedRoot, 'app.js'), body);
  const payload = Buffer.from(
    JSON.stringify({
      format: 1,
      version: '1.0.0',
      minimumInstalledVersion: '0.9.0',
      fromSchemaDigest: 'a'.repeat(64),
      toSchemaDigest: 'a'.repeat(64),
      nodeMajor: 24,
      postgresMajor: 18,
      files: [
        {
          path: 'app.js',
          bytes: Buffer.byteLength(body),
          sha256: createHash('sha256').update(body).digest('hex'),
        },
      ],
    }),
  ).toString('base64url');
  await writeFile(
    join(installedRoot, 'release.json'),
    JSON.stringify({
      keyId: 'test',
      payload,
      signature: sign(
        null,
        Buffer.from(`GST-RELEASE-V1\ntest\n${payload}`),
        privateKey,
      ).toString('base64url'),
    }),
  );
  const lease = await acquireUpdateJournal(root, installationId, operationId);
  await lease.record({
    operationId,
    installationId,
    version: '1.1.0',
    phase: 'switching',
  });
  await lease.record({
    operationId,
    installationId,
    version: '1.1.0',
    phase: 'recovery_required',
  });
  await lease.release();
  const candidate = 'gst_recovery_' + 'a'.repeat(32);
  await writeFile(
    join(lease.directory, 'cutover-intent.json'),
    JSON.stringify({
      activeDatabase: 'gst_fixture',
      recoveryDatabase: candidate,
      previousDatabase: candidate.replace('recovery', 'previous'),
      databases: [
        { name: 'gst_fixture', oid: 1, open: true, owned: true },
        { name: candidate, oid: 2, open: false, owned: true },
      ],
      installedRoot,
      stagedRoot,
      installedVersion: '1.0.0',
      targetVersion: '1.1.0',
    }),
  );
  await writeFile(
    join(root, 'installation.json'),
    JSON.stringify({
      format: 1,
      installationId,
      version: '1.1.0',
      schemaDigest: 'a'.repeat(64),
      appRoot: stagedRoot,
      operationId,
    }),
  );
  const options = {
    operationId,
    installationId,
    journalParent: root,
    installedRoot,
    stagedRoot,
    installed: { version: '1.0.0', schemaDigest: 'a'.repeat(64) },
    connectionString:
      'postgresql://operator:fixture@127.0.0.1:5432/gst_fixture',
    runtimeConnectionString:
      'postgresql://runtime:fixture@127.0.0.1:5432/gst_fixture',
    releaseTrust: trust,
  };
  const service = {
    stop: vi.fn(async () => {}),
    restoreOriginal: vi.fn(async () => {}),
    startOriginal: vi.fn(async () => {}),
    assertOriginalReady: vi.fn(async () => {}),
    admitOriginal: vi.fn(async () => {}),
  };
  const confirmations = {
    updaterStopped: true,
    installationId,
    acceptRecoveryPoint: true,
  };
  return { root, options, service, confirmations };
}
test('confirmed recovery verifies original signatures, restores metadata and archives rather than erases locks', async () => {
  const f = await fixture();
  expect(await inspectFailedUpdate(f.options)).toMatchObject({
    state: 'activated',
  });
  await expect(
    recoverFailedUpdate(f.options, f.service, f.confirmations),
  ).resolves.toMatchObject({ state: 'original_restored' });
  expect(await readInstallationState(f.root)).toMatchObject({
    version: '1.0.0',
    appRoot: f.options.installedRoot,
  });
  await expect(lstat(join(f.root, 'gst-update.lock'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(hook.calls).toBe(1);
  expect(f.service.admitOriginal).toHaveBeenCalledOnce();
}, 60000);
test('missing acknowledgements and wrong installation never stop services or rollback', async () => {
  const f = await fixture();
  for (const confirmations of [
    { ...f.confirmations, updaterStopped: false },
    { ...f.confirmations, acceptRecoveryPoint: false },
    { ...f.confirmations, installationId: randomUUID() },
  ])
    await expect(
      recoverFailedUpdate(f.options, f.service, confirmations),
    ).rejects.toThrow();
  expect(hook.calls).toBe(0);
  expect(f.service.stop).not.toHaveBeenCalled();
}, 60000);
test('unknown database OIDs cannot authorize rollback or startup', async () => {
  const f = await fixture();
  hook.unknown = true;
  expect(await inspectFailedUpdate(f.options)).toMatchObject({
    state: 'unknown',
  });
  await expect(
    recoverFailedUpdate(f.options, f.service, f.confirmations),
  ).rejects.toThrow();
  expect(hook.calls).toBe(0);
  expect(f.service.startOriginal).not.toHaveBeenCalled();
}, 60000);
test('tampered original files keep maintenance stopped without database mutation or startup', async () => {
  const f = await fixture();
  await writeFile(join(f.options.installedRoot, 'app.js'), 'tampered');
  await expect(
    recoverFailedUpdate(f.options, f.service, f.confirmations),
  ).rejects.toThrow();
  expect(hook.calls).toBe(0);
  expect(f.service.stop).toHaveBeenCalledOnce();
  expect(f.service.startOriginal).not.toHaveBeenCalled();
}, 60000);
test('lost rollback reply retains locks and never automatically retries or starts a release', async () => {
  const f = await fixture();
  hook.lostReply = true;
  await expect(
    recoverFailedUpdate(f.options, f.service, f.confirmations),
  ).rejects.toThrow();
  expect(hook.calls).toBe(1);
  expect(hook.activated).toBe(false);
  expect(f.service.startOriginal).not.toHaveBeenCalled();
  expect(
    (
      await lstat(join(f.root, 'gst-update.lock', 'recovery.lock'))
    ).isDirectory(),
  ).toBe(true);
  await expect(
    recoverFailedUpdate(f.options, f.service, f.confirmations),
  ).rejects.toThrow();
  expect(hook.calls).toBe(1);
}, 60000);
