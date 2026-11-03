import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { InstallationState } from './installation-state.js';
import type * as DatabaseOperations from '@gst/database/operations';
import { createDatabaseUpdateHost } from './database-update-host.js';
import { runAssistedUpdate } from './assisted-update.js';

// Fault injection tests for orchestration across different release schemas.
// Real backup/migration/OID/role behavior has separate PostgreSQL integration tests.
const hooks = vi.hoisted(() => ({
  old: 'a'.repeat(64),
  target: 'b'.repeat(64),
  installed: 'a'.repeat(64),
  directory: '',
  state: undefined as InstallationState | undefined,
  manifest: {},
  originalManifest: {},
  prepare: vi.fn(),
  switch: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('./release-package.js', () => ({
  verifyReleasePackage: async () => hooks.manifest,
}));
vi.mock('./offline-installer.js', () => ({
  verifyOfflineRelease: async () => hooks.originalManifest,
}));
vi.mock('./installation-state.js', () => ({
  readInstallationState: async () => structuredClone(hooks.state),
  replaceInstallationState: async (...args: unknown[]) => {
    hooks.replace(...args);
  },
}));
vi.mock('./update-journal.js', () => ({
  acquireUpdateJournal: async () => ({
    directory: hooks.directory,
    record: async () => {},
    release: async () => {},
  }),
}));
vi.mock('./update-eligibility.js', () => ({
  assertUpdateEligibility: () => {},
}));
vi.mock('@gst/database/operations', async (original) => ({
  ...(await original<typeof DatabaseOperations>()),
  migrationDigest: async () => hooks.target,
  inspectUpdateDatabase: async (
    options: { candidate?: string },
    inspect: (db: unknown, digest: string) => unknown,
  ) => inspect({}, options.candidate ? hooks.target : hooks.installed),
  readUpdateOrganizations: async () => [{ id: 'fixture' }],
  createEncryptedBackup: async () => ({
    schemaDigest: hooks.old,
    createdAt: new Date().toISOString(),
  }),
  verifyRestore: async () => ({ verified: true, schemaDigest: hooks.old }),
  prepareRecovery: (...args: unknown[]) => hooks.prepare(...args),
  provisionRecoveryRuntime: async () => {},
  recoverySwitchStatus: async () => ({ databases: [] }),
  switchRecovery: (...args: unknown[]) => {
    hooks.installed = hooks.target;
    return hooks.switch(...args);
  },
}));
vi.mock('@gst/database', () => ({
  createDatabase: () => ({ ready: async () => {}, close: async () => {} }),
}));

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const path = resolve(root);
    if (
      dirname(path) !== resolve(tmpdir()) ||
      !basename(path).startsWith('gst-forward-host-test-')
    )
      throw new Error('Unsafe fixture cleanup.');
    await rm(path, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'gst-forward-host-test-'));
  roots.push(directory);
  const installationId = randomUUID(),
    operationId = randomUUID();
  Object.assign(hooks, {
    directory,
    old: 'a'.repeat(64),
    target: 'b'.repeat(64),
    installed: 'a'.repeat(64),
  });
  hooks.prepare.mockReset().mockResolvedValue({
    recoveryDatabase: 'gst_recovery_' + 'c'.repeat(32),
    schemaDigest: hooks.target,
  });
  hooks.switch.mockReset().mockResolvedValue({ state: 'activated' });
  hooks.replace.mockReset();
  hooks.state = {
    format: 1,
    installationId,
    version: '1.0.0',
    schemaDigest: hooks.old,
    appRoot: join(directory, 'original'),
    operationId: null,
  };
  hooks.manifest = {
    format: 1,
    version: '1.1.0',
    minimumInstalledVersion: '1.0.0',
    fromSchemaDigest: hooks.old,
    toSchemaDigest: hooks.target,
    nodeMajor: 24,
    postgresMajor: 18,
    files: [],
  };
  hooks.originalManifest = {
    ...hooks.manifest,
    version: '1.0.0',
    minimumInstalledVersion: '0.0.0',
    toSchemaDigest: hooks.old,
  };
  const service = {
    stop: vi.fn(async () => {}),
    selectRelease: vi.fn(async () => {}),
    startPrivate: vi.fn(async () => {}),
    assertReady: vi.fn(async () => {}),
    admit: vi.fn(async () => {}),
  };
  const installed = { version: '1.0.0', schemaDigest: hooks.old };
  const stagedRoot = join(directory, 'candidate');
  const host = createDatabaseUpdateHost({
    operationId,
    installationId,
    journalParent: directory,
    installedRoot: hooks.state.appRoot,
    stagedRoot,
    installed,
    backup: {
      connectionString: 'postgresql://operator:fixture@127.0.0.1/gst_fixture',
      installationId,
      key: Buffer.alloc(32, 1),
      workDirectory: join(directory, 'work'),
    },
    runtimeConnectionString:
      'postgresql://runtime:fixture@127.0.0.1/gst_fixture',
    entitlementTrust: new Map(),
    releaseTrust: new Map(),
    service,
  });
  return {
    directory,
    service,
    options: {
      operationId,
      installationId,
      stagedRoot,
      installed,
      releaseTrust: new Map(),
      host,
    },
  };
}

test('different schemas require the target operator migrations and record both schema bindings before cutover', async () => {
  const f = await fixture();
  await expect(runAssistedUpdate(f.options)).resolves.toMatchObject({
    phase: 'completed',
  });
  expect(hooks.prepare).toHaveBeenCalledWith(
    expect.any(Object),
    join(f.directory, 'before-update.gstbackup'),
    f.options.installationId,
    hooks.target,
  );
  expect(hooks.switch).toHaveBeenCalledWith(
    expect.objectContaining({ originalSchemaDigest: hooks.old }),
    'activate',
  );
  expect(
    JSON.parse(
      await readFile(join(f.directory, 'cutover-intent.json'), 'utf8'),
    ),
  ).toMatchObject({
    installedSchemaDigest: hooks.old,
    targetSchemaDigest: hooks.target,
  });
  expect(hooks.replace).toHaveBeenCalledWith(
    f.directory,
    hooks.state,
    expect.objectContaining({ schemaDigest: hooks.target, version: '1.1.0' }),
  );
  expect(f.service.admit).toHaveBeenCalledOnce();
  expect(
    JSON.parse(
      await readFile(join(f.directory, 'original-manifest.json'), 'utf8'),
    ),
  ).toMatchObject({ version: '1.0.0', toSchemaDigest: hooks.old });
  expect(
    JSON.parse(
      await readFile(join(f.directory, 'target-manifest.json'), 'utf8'),
    ),
  ).toMatchObject({ version: '1.1.0', toSchemaDigest: hooks.target });
});

test('migration failure keeps the original selected and never starts or admits the candidate', async () => {
  const f = await fixture();
  hooks.prepare.mockRejectedValueOnce(
    new Error('Injected copy migration failure'),
  );
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    recoveryRequired: true,
    stopConfirmed: true,
    phase: 'preparing',
  });
  expect(hooks.switch).not.toHaveBeenCalled();
  expect(hooks.replace).not.toHaveBeenCalled();
  expect(f.service.startPrivate).not.toHaveBeenCalled();
  expect(f.service.admit).not.toHaveBeenCalled();
  expect(f.service.stop).toHaveBeenCalledTimes(2);
});

test('a target without matching trusted migrations is rejected before service exclusion', async () => {
  const f = await fixture();
  hooks.target = 'd'.repeat(64);
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    recoveryRequired: false,
  });
  expect(hooks.prepare).not.toHaveBeenCalled();
  expect(f.service.stop).not.toHaveBeenCalled();
});
