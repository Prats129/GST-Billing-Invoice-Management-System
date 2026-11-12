import { beforeEach, expect, test, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { join } from 'node:path';
import type * as OfflineRepair from './offline-repair.js';
import type * as OfflineInstaller from './offline-installer.js';
import type * as ChildProcess from 'node:child_process';
import type * as Certificates from './certificate-replacement.js';
import type * as FileSystem from 'node:fs/promises';
import type * as Database from '@gst/database';
import type * as DatabaseOperations from '@gst/database/operations';
import {
  prepareLifecycle,
  executeLifecycle,
  lifecycleRequestSchema,
} from './windows-lifecycle.js';

const f = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  retained: undefined as unknown,
  plan: undefined as unknown,
  locked: false,
  native: vi.fn(),
  install: vi.fn(),
  run: vi.fn(),
  recover: vi.fn(),
  certRecover: vi.fn(),
  read: vi.fn(),
  dbClose: vi.fn(),
  license: vi.fn(),
  updateHost: vi.fn(),
  updateRun: vi.fn(),
  manifest: {} as Record<string, unknown>,
  stagedChanged: false,
  writes: [] as string[],
}));
vi.mock('./offline-repair.js', async (importOriginal) => ({
  ...(await importOriginal<typeof OfflineRepair>()),
  retainedBinding: async () => structuredClone(f.retained),
  prepareOfflineRepair: async () => ({ config: {}, version: '1.0.0' }),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFile: (
    _executable: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string) => void,
  ) => callback(null, '{"GSTBillingApi":"Stopped","httpsDatabaseReady":false}'),
}));
vi.mock('./offline-installer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof OfflineInstaller>()),
  prepareOfflineInstallation: async () => structuredClone(f.plan),
  verifyOfflineRelease: async (path: string) => ({
    ...structuredClone(f.manifest),
    ...(f.stagedChanged && path.includes('gst-release-') ? { files: [] } : {}),
  }),
}));
vi.mock('@gst/database/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof DatabaseOperations>()),
  migrationDigest: async () => 'b'.repeat(64),
}));
vi.mock('./update-eligibility.js', () => ({
  checkOfflineUpdateEligibility: async () => ({ eligible: true }),
}));
vi.mock('./windows-update-host.js', () => ({
  createWindowsUpdateHost: (...args: unknown[]) => f.updateHost(...args),
}));
vi.mock('./assisted-update.js', () => ({
  runAssistedUpdate: (...args: unknown[]) => f.updateRun(...args),
}));
vi.mock('./offline-native.js', () => ({
  installOffline: (...args: unknown[]) => f.install(...args),
  createOfflineNativeHost: async () => {
    f.native();
    return {};
  },
}));
vi.mock('./offline-maintenance.js', () => ({
  runOfflineMaintenance: (...args: unknown[]) => f.run(...args),
  recoverOfflineMaintenance: (...args: unknown[]) => f.recover(...args),
  readOfflineMaintenanceContext: async () => ({
    kind: 'uninstall',
    configuration: undefined,
  }),
  inspectOfflineMaintenance: async () => ({
    fingerprint: 'b'.repeat(64),
    actorAlive: false,
  }),
}));
vi.mock('./certificate-replacement.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Certificates>()),
  readCertificateOperationFile: async (path: string) => {
    f.read(path);
    const found =
      f.files.get(path) ??
      (path.endsWith('release-trust.json')
        ? f.files.get('pinned-trust')
        : undefined);
    if (!found && path.endsWith('.ps1'))
      return Buffer.from('# harmless native fixture');
    if (!found) throw new Error('Missing fixture file');
    return Buffer.from(found);
  },
  inspectCertificateReplacement: async () => ({
    active: { key: 'a'.repeat(64), cert: 'c'.repeat(64) },
    previous: { key: 'b'.repeat(64), cert: 'd'.repeat(64) },
    replacement: { key: 'e'.repeat(64), cert: 'f'.repeat(64) },
  }),
  recoverCertificateReplacement: (...args: unknown[]) => f.certRecover(...args),
}));
vi.mock('./windows-update-service.js', () => ({
  createWindowsCertificateService: () => ({}),
}));
vi.mock('./release-staging.js', () => ({
  assertPrivateDirectory: async () => {},
  stageReleasePackage: async () => ({
    directory: join(root, 'releases', 'gst-release-ABC123'),
  }),
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  open: async (path: string) => {
    if (!path.endsWith('launcher-update.json'))
      throw new Error('Unexpected write');
    return {
      writeFile: async (value: string) => {
        f.writes.push(value);
      },
      sync: async () => {},
      close: async () => {},
    };
  },
  lstat: async (path: string) => {
    if (path.endsWith('gst-update.lock') && f.locked) return {};
    throw Object.assign(new Error(), { code: 'ENOENT' });
  },
}));
vi.mock('@gst/database', async (importOriginal) => ({
  ...(await importOriginal<typeof Database>()),
  createDatabase: () => ({ close: f.dbClose }),
}));
vi.mock('../licensing/install.js', () => ({
  installEntitlement: (...args: unknown[]) => f.license(...args),
}));
const root = 'C:\\GST',
  id = '25a3a48f-7f24-4b65-ae13-b55cd3d5fa31';
const sha = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const installConfig = {
  format: 1,
  installationId: id,
  root,
  bundleRoot: 'C:\\Bundle',
  releaseTrustFile: 'C:\\Private\\release-trust.json',
  origin: 'https://127.0.0.1:3443',
  databasePort: 55432,
  privateSubnet: '192.168.1.0/24',
  tlsKeyFile: 'C:\\Private\\key.pem',
  tlsCertFile: 'C:\\Private\\cert.pem',
  certificateTrustFile: 'C:\\Private\\ca.crt',
  certificateTrustSha256: 'a'.repeat(64),
  entitlementTrustFile: 'C:\\Private\\entitlements.json',
  ownerInputFile: 'C:\\Private\\owner.json',
  backupCredentialFile: 'C:\\Private\\backup.xml',
  backupAccountSid: 'S-1-5-21-1-2-3-1001',
  backupDailyAt: '03:00',
};
function put(path: string, value: unknown) {
  f.files.set(
    path,
    Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  f.writes.length = 0;
  f.stagedChanged = false;
  f.files.clear();
  f.locked = false;
  const { publicKey } = generateKeyPairSync('ed25519');
  const trust = {
    publisher: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  put('pinned-trust', trust);
  put(installConfig.releaseTrustFile, trust);
  put(join(root, 'runtime', 'entitlement-trust.json'), trust);
  const runtime = [
    'NODE_ENV=production',
    'DEPLOYMENT_EDITION=offline',
    'HOST=127.0.0.1',
    'PORT=3443',
    'APP_ORIGIN=https://127.0.0.1:3443',
    'OFFLINE_INSTALLATION_ID=' + id,
    'DATABASE_URL=postgresql://runtime:fixture@127.0.0.1:55432/gst_billing',
    'TLS_KEY_PATH=C:\\GST\\runtime\\tls\\key.pem',
    'TLS_CERT_PATH=C:\\GST\\runtime\\tls\\cert.pem',
  ].join('\n');
  put(join(root, 'runtime', 'runtime.env'), runtime);
  put(
    join(root, 'operator', 'operator.env'),
    runtime +
      '\nMIGRATION_DATABASE_URL=postgresql://owner:fixture@127.0.0.1:55432/gst_billing',
  );
  f.retained = {
    plan: {
      config: installConfig,
      review: {
        node: {
          directory: 'node',
          executables: { 'node.exe': 'a'.repeat(64) },
        },
        winsw: { file: 'winsw.exe' },
        postgres: { directory: 'pgsql' },
      },
      files: [{ path: 'winsw.exe', sha256: 'a'.repeat(64) }],
    },
    state: {
      version: '1.0.0',
      schemaDigest: 'a'.repeat(64),
      appRoot: 'C:\\GST\\releases\\1.0.0',
    },
    fingerprints: {},
    binding: 'a'.repeat(64),
  };
  f.plan = {
    config: installConfig,
    version: '1.0.0',
    files: [],
    inputs: {},
    schemaDigest: 'a'.repeat(64),
  };
  f.manifest = {
    format: 1,
    version: '1.1.0',
    minimumInstalledVersion: '1.0.0',
    fromSchemaDigest: 'a'.repeat(64),
    toSchemaDigest: 'b'.repeat(64),
    nodeMajor: 24,
    postgresMajor: 18,
    files: [{ path: 'main.js', bytes: 1, sha256: 'c'.repeat(64) }],
  };
  f.files.set(join(root, 'backup-key', 'backup.key'), Buffer.alloc(32, 7));
  f.updateHost.mockImplementation(() => ({
    acquire: async () => ({ release: async () => {} }),
    record: async () => {},
  }));
  f.updateRun.mockImplementation(async (options) => {
    await options.host.acquire();
    return { phase: 'completed' };
  });
});

test('fixed action contracts reject commands, extra confirmation fields, UNC and traversal paths', () => {
  for (const request of [
    { action: 'exec', root, command: 'whoami' },
    { action: 'backup', root, executable: 'C:\\other.exe' },
    { action: 'status', root: '\\\\remote\\root' },
    { action: 'status', root: 'C:\\safe\\..\\GST' },
    {
      action: 'recover',
      root,
      operatorStopped: false,
      acceptRecoveryPoint: true,
    },
    {
      action: 'recover',
      root,
      operatorStopped: true,
      acceptRecoveryPoint: false,
    },
  ])
    expect(lifecycleRequestSchema.safeParse(request).success).toBe(false);
});

test('installation preview is read-only and rejects a changed plan before native effects', async () => {
  const request = { action: 'install', configuration: installConfig };
  const preview = await prepareLifecycle(request);
  expect(f.install).not.toHaveBeenCalled();
  f.plan = { ...(f.plan as object), inputs: { altered: 'x' } };
  await expect(
    executeLifecycle(request, preview.approval),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(f.install).not.toHaveBeenCalled();
});

test('a different release signing key cannot authorize an installation', async () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  put(installConfig.releaseTrustFile, {
    publisher: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  await expect(
    prepareLifecycle({ action: 'install', configuration: installConfig }),
  ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  expect(f.install).not.toHaveBeenCalled();
});

test('changed retained identity blocks a reviewed uninstall; successful execution keeps its native safety engine', async () => {
  const request = { action: 'uninstall', root },
    preview = await prepareLifecycle(request);
  (f.retained as { binding: string }).binding = 'b'.repeat(64);
  await expect(
    executeLifecycle(request, preview.approval),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(f.native).not.toHaveBeenCalled();
  const fresh = await prepareLifecycle(request);
  await executeLifecycle(request, fresh.approval);
  expect(f.run).toHaveBeenCalledWith(
    expect.objectContaining({
      parent: join(root, 'operations'),
      installationId: id,
    }),
    'uninstall',
    {},
  );
});

test('an unresolved maintenance lock blocks new business-maintenance actions', async () => {
  f.locked = true;
  for (const action of ['backup', 'uninstall'])
    await expect(prepareLifecycle({ action, root })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  expect(f.native).not.toHaveBeenCalled();
});

test('status discloses only installation identity and clearly limits health claims', async () => {
  const preview = await prepareLifecycle({ action: 'status', root });
  const output = JSON.stringify(preview.summary);
  expect(output).not.toContain('postgresql');
  expect(output).not.toContain('fixture');
  expect(output).toContain('Separate-client LAN acceptance is still required');
  expect(preview.summary).toMatchObject({
    host: { GSTBillingApi: 'Stopped', httpsDatabaseReady: false },
  });
});

test('signed grant preview rejects a wrong installation before opening the operator database', async () => {
  const keys = generateKeyPairSync('ed25519');
  put(join(root, 'runtime', 'entitlement-trust.json'), {
    publisher: keys.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
  });
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      entitlementId: 'd13b4f57-4b79-4c4e-aa11-77d824c3b88c',
      organizationId: 'e28c9747-54dd-4f41-9e32-af0a58225678',
      edition: 'offline',
      installationId: 'f13b4f57-4b79-4c4e-aa11-77d824c3b88c',
      kind: 'perpetual',
      sequence: 1,
      issuedAt: '2026-11-01T00:00:00Z',
      startsAt: '2026-11-01T00:00:00Z',
      expiresAt: null,
      maintenanceUntil: null,
    }),
  ).toString('base64url');
  put('C:\\Private\\grant.json', {
    keyId: 'publisher',
    payload,
    signature: sign(
      null,
      Buffer.from('GST-ENTITLEMENT-V1\npublisher\n' + payload),
      keys.privateKey,
    ).toString('base64url'),
  });
  await expect(
    prepareLifecycle({
      action: 'license',
      root,
      file: 'C:\\Private\\grant.json',
    }),
  ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  expect(f.license).not.toHaveBeenCalled();
  expect(f.dbClose).not.toHaveBeenCalled();
});

test('repair/uninstall recovery binds a fresh inspection and routes the recorded operation', async () => {
  const operationId = 'a13b4f57-4b79-4c4e-aa11-77d824c3b88c';
  put(join(root, 'operations', 'gst-update.lock', 'owner.json'), {
    operationId,
    installationId: id,
    nonce: operationId,
  });
  put(
    join(root, 'operations', 'gst-update-' + operationId, 'events.jsonl'),
    JSON.stringify({ operationKind: 'uninstall' }) + '\n',
  );
  const request = {
    action: 'recover',
    root,
    operatorStopped: true,
    acceptRecoveryPoint: true,
  };
  const preview = await prepareLifecycle(request);
  await executeLifecycle(request, preview.approval);
  expect(f.recover).toHaveBeenCalledWith(
    expect.objectContaining({
      binding: sha({ retained: 'a'.repeat(64), repair: undefined }),
    }),
    operationId,
    {},
    {
      installationId: id,
      operatorStopped: true,
      expectedFingerprint: 'b'.repeat(64),
    },
  );
});

test('update wires one operation identity, correct installed service root and durable recovery reference', async () => {
  const request = {
    action: 'update',
    root,
    bundleRoot: 'C:\\TargetBundle',
    releaseTrustFile: installConfig.releaseTrustFile,
  };
  const preview = await prepareLifecycle(request);
  await expect(
    executeLifecycle(request, preview.approval),
  ).resolves.toMatchObject({ phase: 'completed' });
  const host = f.updateHost.mock.calls[0]![0];
  const run = f.updateRun.mock.calls[0]![0];
  expect(host.operationId).toBe(run.operationId);
  expect(host.service.serviceRoot).toBe(join(root, 'services', 'api'));
  expect(host.service.backupAccountSid).toBe(installConfig.backupAccountSid);
  expect(JSON.parse(f.writes[0]!)).toMatchObject({
    installedRoot: 'C:\\GST\\releases\\1.0.0',
    stagedRoot: join(root, 'releases', 'gst-release-ABC123'),
    releaseTrustFile: installConfig.releaseTrustFile,
  });
  expect(host.backup.key).toEqual(Buffer.alloc(32)); // cleared after completion
});

test('a staged release different from the approved inventory never reaches the host update engine', async () => {
  const request = {
    action: 'update',
    root,
    bundleRoot: 'C:\\TargetBundle',
    releaseTrustFile: installConfig.releaseTrustFile,
  };
  const preview = await prepareLifecycle(request);
  f.stagedChanged = true;
  await expect(
    executeLifecycle(request, preview.approval),
  ).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(f.updateHost).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});
