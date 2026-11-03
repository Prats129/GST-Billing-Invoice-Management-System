import { afterEach, expect, test } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createWindowsUpdateService,
  windowsUpdateServiceSchema,
} from './windows-update-service.js';

const roots: string[] = [];
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const target = resolve(root);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('gst-native-adapter-test-')
    )
      throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
});
const base = {
  operationId: randomUUID(),
  serviceRoot: 'C:\\GST\\service',
  nodePath: 'C:\\GST\\node.exe',
  nodeSha256: 'a'.repeat(64),
  wrapperSha256: 'b'.repeat(64),
  installedRoot: 'C:\\GST\\old',
  stagedRoot: 'C:\\GST\\new',
  environmentFile: 'C:\\GST\\runtime.env',
  environmentSha256: 'c'.repeat(64),
  journalDirectory: 'C:\\GST\\journal',
  origin: 'https://localhost:3443',
  port: 3443,
  backupTaskName: null,
};
test('native service schema rejects remote paths, unsafe identities and origin credentials', () => {
  expect(windowsUpdateServiceSchema.parse(base)).toMatchObject({ port: 3443 });
  for (const change of [
    { serviceRoot: '\\\\remote\\share' },
    { nodePath: 'C:\\GST\\node.exe"' },
    { backupTaskName: 'OtherCompanyBackup' },
    { origin: 'https://user:password@localhost:3443' },
    { migrationPassword: 'unexpected' },
    { stagedRoot: base.installedRoot },
    { stagedRoot: join(base.installedRoot, 'nested') },
    { journalDirectory: join(base.stagedRoot, 'private') },
  ])
    expect(() =>
      windowsUpdateServiceSchema.parse({ ...base, ...change }),
    ).toThrow();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gst-native-adapter-test-'));
  roots.push(root);
  const installationId = randomUUID();
  const runtimeConnectionString =
    'postgresql://fixture:non-production@127.0.0.1:55432/fixture';
  const environmentFile = join(root, 'runtime.env');
  const environment = `NODE_ENV=production\nDEPLOYMENT_EDITION=offline\nDATABASE_URL=${runtimeConnectionString}\nOFFLINE_INSTALLATION_ID=${installationId}\n`;
  await writeFile(environmentFile, environment);
  const hashes = {} as {
    'Invoke-UpdateService.ps1': string;
    'UpdateService.ps1': string;
    'Common.ps1': string;
    'DeploymentChecks.ps1': string;
  };
  for (const name of [
    'Common.ps1',
    'DeploymentChecks.ps1',
    'UpdateService.ps1',
  ] as const) {
    const bytes = await readFile(
      fileURLToPath(
        new URL('../../../windows-installer/scripts/' + name, import.meta.url),
      ),
    );
    await writeFile(join(root, name), bytes);
    hashes[name] = digest(bytes);
  }
  // Only the test entrypoint is substituted. Real verified helper definitions
  // are loaded, but no service/firewall/registry/network functions are invoked.
  const wrapper = await readFile(
    fileURLToPath(
      new URL(
        '../../../windows-installer/scripts/Invoke-UpdateService.ps1',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  const harmless = wrapper.replace(
    'Invoke-UpdateService $Action $configuration',
    "if ($env:DATABASE_URL -or $env:MIGRATION_DATABASE_URL -or $env:AUTH_DATA_KEY) { throw 'Inherited operator secret' }; if ($Action -ne 'Stop') { throw 'Wrong action' }",
  );
  await writeFile(join(root, 'Invoke-UpdateService.ps1'), harmless);
  hashes['Invoke-UpdateService.ps1'] = digest(harmless);
  return {
    root,
    config: {
      ...base,
      environmentFile,
      environmentSha256: digest(environment),
    },
    scripts: { directory: root, hashes },
    expected: { runtimeConnectionString, installationId },
  };
}

test.runIf(process.platform === 'win32')(
  'executes verified helper bytes with a benign entrypoint and no inherited operator secrets',
  async () => {
    const f = await fixture();
    await expect(
      createWindowsUpdateService(f.config, f.scripts, f.expected).stop(),
    ).resolves.toBeUndefined();
  },
  30000,
);

test.runIf(process.platform === 'win32')(
  'changed scripts and runtime bindings fail before executing any action',
  async () => {
    const f = await fixture();
    await expect(
      createWindowsUpdateService(f.config, f.scripts, {
        ...f.expected,
        installationId: randomUUID(),
      }).stop(),
    ).rejects.toThrow('Runtime binding');
    await writeFile(
      join(f.root, 'UpdateService.ps1'),
      'throw "Tampered helper must never execute"',
    );
    await expect(
      createWindowsUpdateService(f.config, f.scripts, f.expected).stop(),
    ).rejects.toThrow('scripts changed');
  },
  30000,
);
