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

const state = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  manifest: undefined as ReleaseManifest | undefined,
  verify: vi.fn(),
  trust: vi.fn(),
}));
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
            .manifest!.files.filter((f) => f.path.startsWith('app/'))
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
