import { beforeEach, expect, test, vi } from 'vitest';
import { win32 } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import type { ReleaseManifest } from './release-package.js';
import type * as ReleasePackage from './release-package.js';
import type * as CertificateProbe from './certificate-probe.js';
import {
  offlineInstallSchema,
  prepareOfflineInstallation,
} from './offline-installer.js';
import { certificateHash } from './certificate-probe.js';
import {
  prepareOfflineRepair,
  retainedBinding,
  offlineRepairSchema,
} from './offline-repair.js';
import type * as FileSystem from 'node:fs/promises';

const state = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  manifest: undefined as ReleaseManifest | undefined,
  verify: vi.fn(),
  trust: vi.fn(),
  installation: undefined as Record<string, unknown> | undefined,
}));
vi.mock('./installation-state.js', () => ({
  readInstallationState: async () => state.installation,
}));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FileSystem>('node:fs/promises');
  return {
    ...actual,
    lstat: async (path: Parameters<typeof actual.lstat>[0]) => {
      if (String(path).endsWith('install.lock'))
        throw Object.assign(new Error(), { code: 'ENOENT' });
      return actual.lstat(path);
    },
  };
});
vi.mock('./certificate-replacement.js', () => ({
  readCertificateOperationFile: async (file: string) => {
    const bytes = state.files.get(win32.normalize(file));
    if (!bytes) throw new Error('Missing fixture input');
    return Buffer.from(bytes);
  },
}));
vi.mock('./release-staging.js', () => ({
  assertPrivateDirectory: vi.fn(async () => {}),
}));
vi.mock('@gst/database/operations', () => ({
  migrationDigest: async () => 'a'.repeat(64),
}));
vi.mock('./release-package.js', async () => {
  const actual = await vi.importActual<typeof ReleasePackage>(
    './release-package.js',
  );
  return {
    ...actual,
    verifyReleasePackage: async (...args: unknown[]) => {
      state.verify(...args);
      if (win32.basename(String(args[0])) === 'app')
        return {
          ...state.manifest!,
          files: state
            .manifest!.files.filter(
              (f) => f.path.startsWith('app/') && f.path !== 'app/release.json',
            )
            .map((f) => ({ ...f, path: f.path.slice(4) })),
        };
      return state.manifest!;
    },
  };
});
vi.mock('../tls.js', () => ({
  loadServerTls: () => ({
    httpsOptions: {
      key: Buffer.from('ephemeral'),
      cert: Buffer.from('fixture'),
    },
  }),
}));
vi.mock('./certificate-probe.js', async () => {
  const actual = await vi.importActual<typeof CertificateProbe>(
    './certificate-probe.js',
  );
  return {
    ...actual,
    certificateLeafHash: () => 'd'.repeat(64),
    verifyCertificateTrust: async () => state.trust(),
  };
});
const config = {
  format: 1,
  installationId: '25a3a48f-7f24-4b65-ae13-b55cd3d5fa31',
  root: 'C:\\GST',
  bundleRoot: 'C:\\Publisher\\Bundle',
  releaseTrustFile: 'C:\\Private\\release-trust.json',
  origin: 'https://gst-host:3443',
  databasePort: 55432,
  privateSubnet: '192.168.1.0/24',
  tlsKeyFile: 'C:\\Private\\key.pem',
  tlsCertFile: 'C:\\Private\\cert.pem',
  certificateTrustFile: 'C:\\Private\\ca.crt',
  certificateTrustSha256: certificateHash(Buffer.from('fixture CA')),
  entitlementTrustFile: 'C:\\Private\\entitlements.json',
  ownerInputFile: 'C:\\Private\\owner.json',
  backupCredentialFile: 'C:\\Private\\backup.xml',
  backupAccountSid: 'S-1-5-21-1-2-3-1001',
  backupDailyAt: '03:00',
};
let review: Record<string, unknown>;
function store(file: string, value: unknown) {
  state.files.set(
    win32.normalize(file),
    Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)),
  );
}
beforeEach(() => {
  state.files.clear();
  state.installation = undefined;
  state.verify.mockReset();
  state.trust.mockReset();
  const { publicKey } = generateKeyPairSync('ed25519');
  store(config.releaseTrustFile, {
    publisher: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  store(config.entitlementTrustFile, {
    publisher: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  store(config.ownerInputFile, {
    organizationName: 'Fixture',
    email: 'owner@example.test',
    name: 'Owner',
    password: 'Long fixture password 123!',
  });
  store(config.certificateTrustFile, Buffer.from('fixture CA'));
  for (const file of [
    config.tlsKeyFile,
    config.tlsCertFile,
    config.backupCredentialFile,
  ])
    store(file, Buffer.from('private fixture material'));
  const executables = Object.fromEntries(
    [
      'postgres.exe',
      'initdb.exe',
      'pg_ctl.exe',
      'psql.exe',
      'pg_isready.exe',
      'pg_dump.exe',
      'pg_restore.exe',
    ].map((name) => ['bin/' + name, 'b'.repeat(64)]),
  );
  review = {
    format: 1,
    reviewReference: 'fixture-only',
    reviewedAt: '2026-11-03T00:00:00Z',
    node: {
      archive: 'vendor/node.zip',
      directory: 'node',
      version: '24.22.1',
      origin: 'https://nodejs.org/dist/v24.22.1/node.zip',
      notices: ['notices/node.txt'],
      executables: { 'node.exe': 'b'.repeat(64) },
    },
    postgres: {
      archive: 'vendor/postgres.zip',
      directory: 'pgsql',
      version: '18.6',
      origin: 'https://get.enterprisedb.com/postgresql/postgres.zip',
      notices: ['notices/pg.txt'],
      executables,
    },
    winsw: {
      file: 'vendor/winsw.exe',
      version: '2.12.0',
      variant: 'NET461',
      origin:
        'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
      notices: ['notices/winsw.txt'],
    },
  };
  const files = [
    'app/release.json',
    ...[
      'apps/api/dist/main.js',
      'apps/api/dist/security/host-cli.js',
      'apps/api/dist/operations/offline-ready-cli.js',
      'apps/web/dist/index.html',
      'packages/database/dist/install-cli.js',
      'packages/database/dist/backup-cli.js',
      'packages/database/migrations/meta/_journal.json',
    ].map((p) => 'app/' + p),
    'vendor/node.zip',
    'vendor/postgres.zip',
    'vendor/winsw.exe',
    'notices/node.txt',
    'notices/pg.txt',
    'notices/winsw.txt',
    'artifact-review.json',
    ...[
      'OfflineInstaller',
      'Start-OfflinePostgres',
      'Common',
      'DeploymentChecks',
      'Set-BackupSchedule',
      'Invoke-BackupJob',
      'BackupInstallation',
    ].map((n) => 'installer/' + n + '.ps1'),
  ];
  state.manifest = {
    format: 1,
    version: '1.0.0',
    minimumInstalledVersion: '0.0.0',
    fromSchemaDigest: 'a'.repeat(64),
    toSchemaDigest: 'a'.repeat(64),
    nodeMajor: 24,
    postgresMajor: 18,
    files: files.map((path) => ({ path, bytes: 20, sha256: 'b'.repeat(64) })),
  };
  const envelope = {
    payload: Buffer.from(JSON.stringify(state.manifest)).toString('base64url'),
  };
  store(win32.join(config.bundleRoot, 'release.json'), envelope);
  store(win32.join(config.bundleRoot, 'app', 'release.json'), envelope);
  store(win32.join(config.bundleRoot, 'artifact-review.json'), review);
});
test('installer rejects unsafe paths, non-private/wide subnets and extra fields before effects', () => {
  expect(offlineInstallSchema.parse(config)).toEqual(config);
  for (const change of [
    { root: 'C:\\GST:stream' },
    { root: 'C:\\con' },
    { root: 'C:\\GST\\..\\Other' },
    { privateSubnet: '0.0.0.0/0' },
    { privateSubnet: '192.168.1.3/24' },
    { privateSubnet: '10.0.0.0/7' },
    { origin: 'http://gst-host:3443' },
    { origin: 'https://gst-host' },
    { origin: 'https://gst-host:80' },
    { unknown: true },
  ])
    expect(() =>
      offlineInstallSchema.parse({ ...config, ...change }),
    ).toThrow();
});
test('verified prerequisites produce a secret-free pinned plan and validate both signed inventories', async () => {
  const plan = await prepareOfflineInstallation(config);
  expect(state.verify).toHaveBeenCalledTimes(2);
  expect(state.trust).toHaveBeenCalledOnce();
  expect(plan.inputs[config.ownerInputFile]).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(plan)).not.toContain('Long fixture password');
  expect(plan.leafSha256).toBe('d'.repeat(64));
});
test('missing approved tools block preparation', async () => {
  state.manifest!.files = state.manifest!.files.filter(
    (f) => f.path !== 'vendor/winsw.exe',
  );
  await expect(prepareOfflineInstallation(config)).rejects.toThrow(
    'Approved executable inventory missing',
  );
});
test('wrong trust pin or runtime baseline cannot reach certificate acceptance', async () => {
  await expect(
    prepareOfflineInstallation({
      ...config,
      certificateTrustSha256: 'f'.repeat(64),
    }),
  ).rejects.toThrow('Approved certificate trust changed');
  expect(state.trust).not.toHaveBeenCalled();
  (review.node as { version: string }).version = '22.13.0';
  store(win32.join(config.bundleRoot, 'artifact-review.json'), review);
  await expect(prepareOfflineInstallation(config)).rejects.toThrow(
    'Approved supported vendor versions required',
  );
});

test('certificate path or hostname failure blocks preparation', async () => {
  state.trust.mockRejectedValueOnce(new Error('TLS trust failed'));
  await expect(prepareOfflineInstallation(config)).rejects.toThrow(
    'TLS trust failed',
  );
});

test('a signed package missing an installer entrypoint is refused before native execution', async () => {
  state.manifest!.files = state.manifest!.files.filter(
    (f) => f.path !== 'app/packages/database/dist/install-cli.js',
  );
  await expect(prepareOfflineInstallation(config)).rejects.toThrow(
    'Required signed application entrypoint missing',
  );
  expect(state.trust).not.toHaveBeenCalled();
});

test('input changes during certificate validation cannot become an accepted plan', async () => {
  state.trust.mockImplementationOnce(() =>
    store(config.ownerInputFile, Buffer.from('changed private input')),
  );
  await expect(prepareOfflineInstallation(config)).rejects.toThrow(
    'Installer inputs changed during preflight',
  );
});

async function repairFixture() {
  const plan = await prepareOfflineInstallation(config);
  const root = config.root;
  state.installation = {
    format: 1,
    installationId: config.installationId,
    version: '1.0.0',
    schemaDigest: 'a'.repeat(64),
    appRoot: win32.join(root, 'releases', '1.0.0'),
    operationId: null,
  };
  store(win32.join(root, 'operator', 'native-installation.json'), plan);
  const task = Buffer.from('fixture task definition');
  store(win32.join(root, 'operator', 'backup-task.xml'), task);
  store(win32.join(root, 'operator', 'installed.json'), {
    installationId: config.installationId,
    state: 'installed',
    taskSha256: certificateHash(task).toUpperCase(),
  });
  for (const path of [
    'operator/database-input.json',
    'operator/database-receipt.json',
    'operator/operator.env',
    'operator/backup.env',
    'runtime/entitlement-trust.json',
    'runtime/tls/key.pem',
    'runtime/tls/cert.pem',
    'operations/installation.json',
  ])
    store(win32.join(root, path), Buffer.from('private retained fixture'));
  store(win32.join(root, 'backup-key', 'backup.key'), Buffer.alloc(32, 1));
  store(
    win32.join(root, 'backup-key', 'installation-id.txt'),
    Buffer.from(config.installationId + '\n'),
  );
  store(
    win32.join(root, 'runtime', 'runtime.env'),
    Buffer.from(
      `NODE_ENV=production\nDEPLOYMENT_EDITION=offline\nDATABASE_URL=postgresql://gst_runtime:fixture@127.0.0.1:55432/gst_billing\nOFFLINE_INSTALLATION_ID=${config.installationId}\nAPP_ORIGIN=${config.origin}\nALLOWED_HOSTS=gst-host:3443\nHOST=127.0.0.1\nPORT=3443\nTLS_KEY_PATH=${win32.join(root, 'runtime', 'tls', 'key.pem')}\nTLS_CERT_PATH=${win32.join(root, 'runtime', 'tls', 'cert.pem')}\n`,
    ),
  );
  return {
    root,
    configuration: offlineRepairSchema.parse({
      bundleRoot: config.bundleRoot,
      releaseTrustFile: config.releaseTrustFile,
      certificateTrustFile: config.certificateTrustFile,
      certificateTrustSha256: config.certificateTrustSha256,
      backupCredentialFile: config.backupCredentialFile,
    }),
  };
}
test('repair validates the signed installed version without rereading initial owner credentials', async () => {
  const f = await repairFixture();
  state.files.delete(config.ownerInputFile);
  const result = await prepareOfflineRepair(f.root, f.configuration);
  expect(result.version).toBe('1.0.0');
  expect(
    result.files.every((file) =>
      file.destination.startsWith('C:\\GST\\releases\\1.0.0\\'),
    ),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain('Long fixture password');
});
test('repair refuses another release, changed vendor payload or backup identity', async () => {
  const f = await repairFixture();
  state.manifest!.version = '1.0.1';
  await expect(prepareOfflineRepair(f.root, f.configuration)).rejects.toThrow(
    'exact installed version',
  );
  state.manifest!.version = '1.0.0';
  state.manifest!.files.find(
    (file) => file.path === 'vendor/node.zip',
  )!.sha256 = 'f'.repeat(64);
  await expect(prepareOfflineRepair(f.root, f.configuration)).rejects.toThrow(
    'Approved vendor payload changed',
  );
  store(
    win32.join(f.root, 'backup-key', 'installation-id.txt'),
    Buffer.from('another installation'),
  );
  await expect(retainedBinding(f.root)).rejects.toThrow(
    'Wrong backup identity',
  );
});
test('repair refuses moved installed state, invalid key and redirected runtime', async () => {
  const f = await repairFixture();
  state.installation!.appRoot = 'C:\\Other\\1.0.0';
  await expect(prepareOfflineRepair(f.root, f.configuration)).rejects.toThrow(
    'Wrong retained installation',
  );
  state.installation!.appRoot = 'C:\\GST\\releases\\1.0.0';
  store(win32.join(f.root, 'backup-key', 'backup.key'), Buffer.alloc(31));
  await expect(retainedBinding(f.root)).rejects.toThrow(
    'Invalid retained backup key',
  );
  store(win32.join(f.root, 'backup-key', 'backup.key'), Buffer.alloc(32));
  const file = win32.join(f.root, 'runtime', 'runtime.env');
  store(
    file,
    Buffer.from(
      state.files.get(file)!.toString().replace('PORT=3443', 'PORT=3444'),
    ),
  );
  await expect(prepareOfflineRepair(f.root, f.configuration)).rejects.toThrow(
    'Retained runtime binding changed',
  );
});
test('repair refuses an unverified source inside retained storage', async () => {
  const f = await repairFixture();
  await expect(
    prepareOfflineRepair(f.root, {
      ...f.configuration,
      bundleRoot: 'C:\\GST\\data\\bundle',
    }),
  ).rejects.toThrow('outside the retained installation');
});

test('repair follows a protected release-stage directory after an assisted update', async () => {
  const f = await repairFixture();
  state.installation!.appRoot = 'C:\\GST\\releases\\gst-release-Ab123Z';
  const result = await prepareOfflineRepair(f.root, f.configuration);
  expect(result.appRoot).toBe(state.installation!.appRoot);
  expect(
    result.files.every((file) =>
      file.destination.startsWith(result.appRoot + '\\'),
    ),
  ).toBe(true);
});

test('repair cannot install republished application contents under the same version', async () => {
  const f = await repairFixture();
  state.manifest!.files.find(
    (file) => file.path === 'app/apps/api/dist/main.js',
  )!.sha256 = 'f'.repeat(64);
  await expect(prepareOfflineRepair(f.root, f.configuration)).rejects.toThrow(
    'cannot change the installed release inventory',
  );
});

test('repair binds an updated version to its retained authenticated update inventory', async () => {
  const f = await repairFixture(),
    id = 'b24116ce-50b6-4969-a257-91edff707980';
  state.manifest!.version = '1.0.1';
  state.installation!.version = '1.0.1';
  state.installation!.operationId = id;
  state.installation!.appRoot = 'C:\\GST\\releases\\gst-release-Ab123Z';
  const receipt = {
    ...state.manifest!,
    files: state
      .manifest!.files.filter(
        (file) =>
          file.path.startsWith('app/') && file.path !== 'app/release.json',
      )
      .map((file) => ({ ...file, path: file.path.slice(4) })),
  };
  store(
    win32.join(
      f.root,
      'operations',
      'gst-update-' + id,
      'target-manifest.json',
    ),
    receipt,
  );
  await expect(
    prepareOfflineRepair(f.root, f.configuration),
  ).resolves.toMatchObject({ version: '1.0.1' });
  state.manifest!.files.find(
    (file) => file.path === 'app/apps/api/dist/main.js',
  )!.sha256 = 'f'.repeat(64);
  await expect(prepareOfflineRepair(f.root, f.configuration)).rejects.toThrow(
    'cannot change the installed release inventory',
  );
});
