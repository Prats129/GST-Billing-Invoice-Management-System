import { afterEach, expect, test, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type * as FileSystem from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
  chmod,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { signReleasePackage } from '../../../../scripts/issuer/release.js';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { verifyReleasePackage } from './release-package.js';
import { stageReleasePackage } from './release-staging.js';

const hooks = vi.hoisted(() => ({
  beforeRead: undefined as ((path: string) => void) | undefined,
}));
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof FileSystem>('node:fs');
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      hooks.beforeRead?.(String(args[0]));
      return actual.createReadStream(...args);
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  hooks.beforeRead = undefined;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  // Some Windows development sandboxes grant another account DeleteChild on
  // TEMP. Use a new fixture under the private profile instead of weakening the
  // production ancestor audit to accommodate a writable temporary directory.
  const parent =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? tmpdir())
      : tmpdir();
  const directory = await mkdtemp(join(parent, 'gst-staging-test-'));
  directories.push(directory);
  const root = join(directory, 'source'),
    stagingParent = join(directory, 'staging');
  await mkdir(root);
  await mkdir(stagingParent);
  await writeFile(
    join(root, 'main.js'),
    'throw new Error("staged code must not run");',
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeys = {
    release: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  const trust = loadEntitlementTrust(publicKeys);
  const installed = { version: '1.0.0', schemaDigest: 'ab'.repeat(32) };
  const manifest = await signReleasePackage({
    root,
    privateKey,
    keyId: 'release',
    trust: publicKeys,
    metadata: {
      format: 1,
      version: '1.1.0',
      minimumInstalledVersion: '1.0.0',
      fromSchemaDigest: installed.schemaDigest,
      toSchemaDigest: 'cd'.repeat(32),
      nodeMajor: 24,
      postgresMajor: 18,
    },
  });
  return {
    directory,
    root,
    parent: stagingParent,
    trust,
    installed,
    manifest,
    publicKeys,
  };
}
test('verified staging copies into a private fresh directory and is independent of later download changes', async () => {
  const f = await fixture();
  const result = await stageReleasePackage(
    f.root,
    f.parent,
    f.trust,
    f.installed,
  );
  expect(
    await verifyReleasePackage(result.directory, f.trust, f.installed),
  ).toEqual(f.manifest);
  expect(await readFile(join(result.directory, 'main.js'), 'utf8')).toContain(
    'staged code must not run',
  );
  expect(await readdir(f.parent)).toHaveLength(1);
  if (process.platform !== 'win32')
    expect((await stat(result.directory)).mode & 0o077).toBe(0);
  await writeFile(join(f.root, 'main.js'), 'download changed after staging');
  expect(
    await verifyReleasePackage(result.directory, f.trust, f.installed),
  ).toEqual(f.manifest);
}, 30000);
test('tampered downloads do not write staging files or replace existing operator material', async () => {
  const f = await fixture();
  await writeFile(join(f.parent, 'keep.txt'), 'operator-owned');
  await writeFile(join(f.root, 'main.js'), 'tampered');
  await expect(
    stageReleasePackage(f.root, f.parent, f.trust, f.installed),
  ).rejects.toThrow();
  expect(await readdir(f.parent)).toEqual(['keep.txt']);
  expect(await readFile(join(f.parent, 'keep.txt'), 'utf8')).toBe(
    'operator-owned',
  );
});
test('a same-size download change after preflight is rejected during copying and only its new staging child is removed', async () => {
  const f = await fixture();
  await writeFile(join(f.parent, 'keep.txt'), 'keep');
  const path = join(f.root, 'main.js');
  const original = await readFile(path);
  let reads = 0;
  hooks.beforeRead = (candidate) => {
    if (candidate === path && ++reads === 2)
      writeFileSync(path, Buffer.alloc(original.length, 120));
  };
  await expect(
    stageReleasePackage(f.root, f.parent, f.trust, f.installed),
  ).rejects.toThrow();
  expect(reads).toBe(2);
  expect(await readdir(f.parent)).toEqual(['keep.txt']);
}, 30000);
test('staging refuses a junction parent and any destination inside the download tree', async () => {
  const f = await fixture();
  const alias = join(f.directory, 'alias');
  await symlink(
    f.parent,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(
    stageReleasePackage(f.root, alias, f.trust, f.installed),
  ).rejects.toThrow();
  await expect(
    stageReleasePackage(f.root, f.root, f.trust, f.installed),
  ).rejects.toThrow();
  const nested = join(f.root, 'nested');
  await mkdir(nested);
  await expect(
    stageReleasePackage(f.root, nested, f.trust, f.installed),
  ).rejects.toThrow();
  if (process.platform === 'win32')
    await expect(
      stageReleasePackage(f.root, nested.toUpperCase(), f.trust, f.installed),
    ).rejects.toThrow();
  expect(await readdir(f.parent)).toEqual([]);
});
test('an unsafe parent ACL or permission mode fails before package writes and preserves unrelated files', async () => {
  const f = await fixture();
  await writeFile(join(f.parent, 'keep.txt'), 'keep');
  if (process.platform === 'win32') {
    const script = `$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:GST_TEST_PARENT; $rule=New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]'S-1-5-32-545','DeleteSubdirectoriesAndFiles','None','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:GST_TEST_PARENT -AclObject $acl`;
    await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        env: { ...process.env, GST_TEST_PARENT: f.parent },
        windowsHide: true,
        timeout: 15000,
      },
    );
  } else await chmod(f.parent, 0o777);
  await expect(
    stageReleasePackage(f.root, f.parent, f.trust, f.installed),
  ).rejects.toThrow();
  expect(await readdir(f.parent)).toEqual(['keep.txt']);
}, 30000);
test('the release staging CLI verifies and copies without executing the staged application', async () => {
  const f = await fixture();
  const trustFile = join(f.directory, 'trust.json');
  await writeFile(trustFile, JSON.stringify(f.publicKeys));
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('apps/api/src/operations/release-stage-cli.ts'),
      '--root',
      f.root,
      '--staging-parent',
      f.parent,
      '--trust',
      trustFile,
      '--installed-version',
      f.installed.version,
      '--schema-digest',
      f.installed.schemaDigest,
    ],
    { timeout: 20000 },
  );
  const result = JSON.parse(stdout);
  expect(result).toMatchObject({
    event: 'release_staged',
    version: '1.1.0',
    files: 1,
  });
  expect(stderr).toBe('');
  expect(
    await verifyReleasePackage(result.directory, f.trust, f.installed),
  ).toEqual(f.manifest);
}, 30000);
