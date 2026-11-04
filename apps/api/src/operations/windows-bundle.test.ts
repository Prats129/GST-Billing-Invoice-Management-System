import { afterEach, expect, test, vi } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { assembleWindowsRuntime } from '../../../../scripts/issuer/windows-runtime.js';
import { smokeWindowsBundle } from '../../../../scripts/issuer/windows-bundle-smoke.js';
import {
  assembleWindowsBundle,
  sealWindowsBundle,
  verifyWindowsBundle,
} from '../../../../scripts/issuer/windows-bundle.js';

// Unit fixtures contain inert text, not vendor executables. Real archive/PE
// inspection is exercised separately against the downloaded candidate inputs.
vi.mock('../../../../scripts/issuer/windows-vendor.js', () => ({
  verifyWindowsVendor: vi.fn(async () => ({ executed: false })),
}));
const roots: string[] = [];
const fixtureParent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
// Native ACL inspection launches PowerShell; allow bounded startup under the
// full suite's worker load rather than relying on the five-second default.
vi.setConfig({ testTimeout: 30000 });
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(fixtureParent) ||
      !basename(root).startsWith('gst-bundle-test-')
    )
      throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
async function put(root: string, path: string, data: string) {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, data);
}
async function fixture() {
  // Windows Temp may grant worker accounts delete-child access. Use the private
  // profile parent so production ACL checks remain real rather than mocked.
  const root = await mkdtemp(join(fixtureParent, 'gst-bundle-test-'));
  roots.push(root);
  const repo = join(root, 'repo');
  await put(repo, 'pnpm-lock.yaml', 'fixture-lock');
  await put(
    repo,
    'apps/api/package.json',
    JSON.stringify({
      name: '@gst/api',
      version: '0.0.0',
      type: 'module',
      dependencies: { alpha: '1', beta: '1' },
      devDependencies: { forbidden: '1' },
    }),
  );
  await put(repo, 'apps/api/dist/main.js', 'export {};');
  for (const path of [
    'operations/offline-install-cli.js',
    'operations/offline-repair-ready-cli.js',
    'operations/offline-repair-tree-cli.js',
  ])
    await put(repo, 'apps/api/dist/' + path, 'export {};');
  for (const name of [
    'contracts',
    'database',
    'billing-engine',
    'invoice-renderer',
  ]) {
    await put(
      repo,
      'packages/' + name + '/package.json',
      JSON.stringify({
        name: '@gst/' + name,
        version: '0.0.0',
        type: 'module',
        main: './dist/index.js',
      }),
    );
    await put(repo, 'packages/' + name + '/dist/index.js', 'export {};');
  }
  for (const file of [
    'install-cli.js',
    'verify-retained-cli.js',
    'backup-cli.js',
  ])
    await put(repo, 'packages/database/dist/' + file, 'export {};');
  await put(repo, 'packages/database/migrations/0000_fixture.sql', 'select 1;');
  await put(repo, 'packages/database/migrations/meta/_journal.json', '{}');
  await put(repo, 'apps/web/dist/index.html', '<div id="root"></div>');
  await put(
    repo,
    'apps/web/package.json',
    JSON.stringify({
      name: '@gst/web',
      version: '0.0.0',
      dependencies: { 'browser-only': '1' },
    }),
  );
  await put(
    repo,
    'node_modules/browser-only/package.json',
    JSON.stringify({ name: 'browser-only', version: '1.0.0', license: 'MIT' }),
  );
  await put(
    repo,
    'node_modules/browser-only/LICENSE',
    'Complete frontend license fixture.',
  );
  for (const [name, version, dependencies] of [
    ['alpha', '1.0.0', { shared: '1' }],
    ['beta', '1.0.0', { shared: '2' }],
    ['shared', '1.0.0', {}],
  ] as const) {
    await put(
      repo,
      'node_modules/' + name + '/package.json',
      JSON.stringify({ name, version, main: 'index.js', dependencies }),
    );
    await put(
      repo,
      'node_modules/' + name + '/index.js',
      'module.exports = ' + JSON.stringify(version),
    );
  }
  await put(
    repo,
    'node_modules/beta/node_modules/shared/package.json',
    JSON.stringify({ name: 'shared', version: '2.0.0', main: 'index.js' }),
  );
  await put(
    repo,
    'node_modules/beta/node_modules/shared/index.js',
    'module.exports = "2.0.0"',
  );
  await put(
    repo,
    'node_modules/forbidden/package.json',
    '{"name":"forbidden","version":"1"}',
  );
  await put(repo, 'node_modules/alpha/tests/private.env', 'not runtime');
  await put(repo, 'node_modules/alpha/index.d.ts', 'export {};');
  const helpers = [
    'Common.ps1',
    'DeploymentChecks.ps1',
    'OfflineInstaller.ps1',
    'Start-OfflinePostgres.ps1',
    'Set-BackupSchedule.ps1',
    'Invoke-BackupJob.ps1',
    'BackupInstallation.ps1',
    'OfflineRepair.ps1',
    'UpdateService.ps1',
    'Invoke-UpdateService.ps1',
  ];
  for (const name of helpers)
    await put(
      repo,
      'apps/windows-installer/scripts/' + name,
      '# inert fixture',
    );
  const digest = sha('0000_fixture.sqlselect 1;');
  const config = {
    format: 1,
    repositoryRoot: repo,
    outputDirectory: join(root, 'output'),
    metadata: {
      format: 1,
      version: '0.1.0',
      minimumInstalledVersion: '0.0.0',
      fromSchemaDigest: digest,
      toSchemaDigest: digest,
      nodeMajor: 24,
      postgresMajor: 18,
    },
  };
  return { root, repo, config };
}

test('ordinary runtime preserves conflicting dependency resolution and excludes development files', async () => {
  const f = await fixture(),
    output = join(f.root, 'runtime');
  const report = await assembleWindowsRuntime(f.repo, output, '0.1.0');
  const alpha = createRequire(join(output, 'node_modules/alpha/package.json'));
  const beta = createRequire(join(output, 'node_modules/beta/package.json'));
  expect(alpha('shared')).toBe('1.0.0');
  expect(beta('shared')).toBe('2.0.0');
  expect(report.packages.filter((p) => p.name === 'shared')).toHaveLength(2);
  const notices = JSON.parse(
    await readFile(join(output, 'frontend-notices.json'), 'utf8'),
  );
  expect(notices.packages[0]).toMatchObject({
    name: 'browser-only',
    version: '1.0.0',
  });
  expect(
    await readFile(join(output, notices.packages[0].files[0].path), 'utf8'),
  ).toBe('Complete frontend license fixture.');
  await expect(
    readFile(join(output, 'node_modules/browser-only/package.json')),
  ).rejects.toThrow();
  for (const path of [
    'node_modules/forbidden/package.json',
    'node_modules/alpha/tests/private.env',
    'node_modules/alpha/index.d.ts',
  ])
    await expect(readFile(join(output, path))).rejects.toThrow();
  await expect(
    assembleWindowsRuntime(f.repo, output, '0.1.0'),
  ).rejects.toThrow();
  expect(await readFile(join(f.repo, 'pnpm-lock.yaml'), 'utf8')).toBe(
    'fixture-lock',
  );
});

test('frontend license text is required even when package metadata declares MIT', async () => {
  const f = await fixture();
  await rm(join(f.repo, 'node_modules/browser-only/LICENSE'));
  await expect(
    assembleWindowsRuntime(f.repo, join(f.root, 'missing-notice'), '0.1.0'),
  ).rejects.toThrow('Frontend dependency license text missing');
});

test('missing required dependencies and private-looking package files fail closed', async () => {
  const f = await fixture();
  await put(f.repo, 'node_modules/alpha/.env', 'must never ship');
  await expect(
    assembleWindowsRuntime(f.repo, join(f.root, 'secret'), '0.1.0'),
  ).rejects.toThrow('Private-looking');
  await rm(join(f.repo, 'node_modules/alpha/.env'));
  await rm(join(f.repo, 'node_modules/beta'), { recursive: true });
  await expect(
    assembleWindowsRuntime(f.repo, join(f.root, 'missing'), '0.1.0'),
  ).rejects.toThrow('Missing production dependency');
});

test('runtime rejects redirected package contents without copying outside data', async () => {
  const f = await fixture();
  await put(f.root, 'outside/credential.txt', 'must not copy');
  await symlink(
    join(f.root, 'outside'),
    join(f.repo, 'node_modules/alpha/assets'),
    'junction',
  );
  const output = join(f.root, 'redirected');
  await expect(assembleWindowsRuntime(f.repo, output, '0.1.0')).rejects.toThrow(
    'Unexpected link',
  );
  await expect(
    readFile(join(output, 'node_modules/alpha/assets/credential.txt')),
  ).rejects.toThrow();
});

test('runtime handles dependency cycles and unavailable optional dependencies', async () => {
  const f = await fixture();
  await put(
    f.repo,
    'node_modules/shared/package.json',
    JSON.stringify({
      name: 'shared',
      version: '1.0.0',
      main: 'index.js',
      dependencies: { alpha: '1' },
      optionalDependencies: { absent: '1' },
    }),
  );
  const output = join(f.root, 'cycles');
  const report = await assembleWindowsRuntime(f.repo, output, '0.1.0');
  expect(report.packages.some((p) => p.name === 'absent')).toBe(false);
  const shared = createRequire(
    join(output, 'node_modules/shared/package.json'),
  );
  expect(shared('alpha')).toBe('1.0.0');
});

test('candidate assembly binds source migrations and never reuses existing output', async () => {
  const f = await fixture();
  await expect(
    assembleWindowsBundle({
      ...f.config,
      metadata: { ...f.config.metadata, toSchemaDigest: 'a'.repeat(64) },
    }),
  ).rejects.toThrow('source migrations');
  const candidate = await assembleWindowsBundle(f.config);
  expect(candidate.report.needs).toContain('reviewed-vendor-payloads');
  await expect(assembleWindowsBundle(f.config)).rejects.toThrow();
  expect(
    await readFile(join(candidate.root, 'app/apps/api/dist/main.js'), 'utf8'),
  ).toBe('export {};');
});

test('smoke refuses a changed candidate before executing its application', async () => {
  const f = await fixture();
  const candidate = await assembleWindowsBundle(f.config);
  await put(
    candidate.root,
    'app/apps/api/dist/main.js',
    'throw new Error("must never execute");',
  );
  await expect(smokeWindowsBundle(f.config.outputDirectory)).rejects.toThrow(
    'Locally built runtime changed',
  );
});

async function vendorFixture() {
  const f = await fixture(),
    vendor = join(f.root, 'vendor');
  const review = {
    format: 1,
    reviewReference: 'unit-test-only',
    reviewedAt: '2026-11-04T00:00:00Z',
    node: {
      archive: 'vendor/node.zip',
      directory: 'node-v24.22.1-win-x64',
      version: '24.22.1',
      origin: 'https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip',
      notices: ['notices/node.txt'],
      executables: { 'node.exe': sha('node') },
    },
    postgres: {
      archive: 'vendor/postgres.zip',
      directory: 'pgsql',
      version: '18.6',
      origin:
        'https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip',
      notices: ['notices/postgres.txt'],
      executables: { 'bin/postgres.exe': sha('postgres') },
    },
    winsw: {
      file: 'vendor/WinSW.NET461.exe',
      version: '2.12.0',
      variant: 'NET461',
      origin:
        'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
      notices: ['notices/winsw.txt'],
    },
  };
  const raw = JSON.stringify(review);
  await put(vendor, 'review.json', raw);
  const files: Record<string, string> = {};
  for (const path of [
    'vendor/node.zip',
    'vendor/postgres.zip',
    'vendor/WinSW.NET461.exe',
    'notices/node.txt',
    'notices/postgres.txt',
    'notices/winsw.txt',
  ]) {
    await put(vendor, path, 'inert test: ' + path);
    files[path] = sha('inert test: ' + path);
  }
  await put(
    vendor,
    'approval.json',
    JSON.stringify({
      format: 1,
      reviewSha256: sha(raw),
      approvedBy: 'unit-test-only',
      approvedAt: '2026-11-04T00:00:00Z',
      licensesReviewed: true,
      files,
      evidence: ['https://example.invalid/unit-test-only'],
    }),
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    ...f,
    vendor,
    privateKey,
    keyId: 'test',
    trust: {
      test: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
  };
}
test('sealing refuses missing independent approval before creating either signature', async () => {
  const f = await vendorFixture();
  const candidate = await assembleWindowsBundle({
    ...f.config,
    vendor: {
      directory: f.vendor,
      reviewFile: join(f.vendor, 'review.json'),
    },
  });
  await expect(
    sealWindowsBundle({
      ...f,
      root: candidate.root,
      metadata: f.config.metadata,
    }),
  ).rejects.toThrow();
  await expect(
    readFile(join(candidate.root, 'app/release.json')),
  ).rejects.toThrow();
  await expect(
    readFile(join(candidate.root, 'release.json')),
  ).rejects.toThrow();
});
test('nested signatures verify with ephemeral test keys and detect payload or notice changes', async () => {
  const f = await vendorFixture();
  const candidate = await assembleWindowsBundle({
    ...f.config,
    vendor: {
      directory: f.vendor,
      reviewFile: join(f.vendor, 'review.json'),
      approvalFile: join(f.vendor, 'approval.json'),
    },
  });
  const options = { ...f, root: candidate.root, metadata: f.config.metadata };
  await expect(
    sealWindowsBundle({
      ...options,
      metadata: { ...options.metadata, version: '0.2.0' },
    }),
  ).rejects.toThrow('assembled runtime');
  expect(await sealWindowsBundle(options)).toMatchObject({
    version: '0.1.0',
    platform: 'win32-x64',
  });
  await put(candidate.root, 'notices/node.txt', 'tampered notice');
  await expect(verifyWindowsBundle(candidate.root, f.trust)).rejects.toThrow();
  await put(candidate.root, 'notices/node.txt', 'inert test: notices/node.txt');
  await put(candidate.root, 'app/apps/api/dist/main.js', 'tampered app');
  await expect(verifyWindowsBundle(candidate.root, f.trust)).rejects.toThrow();
});
