import { afterEach, expect, test } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { signReleasePackage } from '../../../../scripts/issuer/release.js';
import { readBounded } from '../../../../scripts/issuer/inputs.js';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import {
  inspectReleaseFiles,
  verifyReleasePackage,
} from './release-package.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'gst-publisher-test-'));
  directories.push(directory);
  const root = join(directory, 'staged');
  await mkdir(join(root, 'app'), { recursive: true });
  await writeFile(
    join(root, 'app', 'main.js'),
    'throw new Error("must not execute staged content");',
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const trust = {
    publisher: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  const metadata = {
    format: 1,
    version: '1.1.0',
    minimumInstalledVersion: '1.0.0',
    fromSchemaDigest: 'ab'.repeat(32),
    toSchemaDigest: 'cd'.repeat(32),
    nodeMajor: 24,
    postgresMajor: 18,
  };
  return { directory, root, privateKey, trust, metadata, keyId: 'publisher' };
}
test('publisher inventories real files and signs a package accepted by the customer verifier', async () => {
  const f = await fixture();
  const manifest = await signReleasePackage(f);
  expect(manifest.files).toEqual([
    expect.objectContaining({
      path: 'app/main.js',
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  ]);
  expect(
    await verifyReleasePackage(f.root, loadEntitlementTrust(f.trust), {
      version: '1.0.0',
      schemaDigest: f.metadata.fromSchemaDigest,
    }),
  ).toEqual(manifest);
  const original = await readFile(join(f.root, 'release.json'), 'utf8');
  await expect(signReleasePackage(f)).rejects.toThrow();
  expect(await readFile(join(f.root, 'release.json'), 'utf8')).toBe(original);
  await writeFile(join(f.root, 'app', 'main.js'), 'tampered');
  await expect(
    verifyReleasePackage(f.root, loadEntitlementTrust(f.trust), {
      version: '1.0.0',
      schemaDigest: f.metadata.fromSchemaDigest,
    }),
  ).rejects.toThrow();
});
test('publisher rejects secrets, mismatched keys and invalid metadata before creating a manifest', async () => {
  const f = await fixture();
  for (const metadata of [
    { ...f.metadata, unexpected: true },
    { ...f.metadata, files: [] },
    { ...f.metadata, version: '1.0.0' },
    { ...f.metadata, nodeMajor: 22 },
  ])
    await expect(signReleasePackage({ ...f, metadata })).rejects.toThrow();
  await expect(
    signReleasePackage({
      ...f,
      privateKey: generateKeyPairSync('ed25519').privateKey,
    }),
  ).rejects.toThrow();
  await writeFile(join(f.root, '.env'), 'ephemeral-fixture-only');
  await expect(signReleasePackage(f)).rejects.toThrow();
  await expect(readFile(join(f.root, 'release.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
test('publisher rejects native directory junctions and case variants of the manifest filename', async () => {
  const f = await fixture();
  await symlink(
    join(f.root, 'app'),
    join(f.root, 'alias'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(signReleasePackage(f)).rejects.toThrow();
  await rm(join(f.root, 'alias'));
  await writeFile(join(f.root, 'RELEASE.JSON'), 'untrusted');
  await expect(signReleasePackage(f)).rejects.toThrow();
});
test('directory case collisions are rejected on case-sensitive publisher filesystems', async () => {
  const f = await fixture();
  await mkdir(join(f.root, 'APP'), { recursive: true });
  // Case-insensitive filesystems resolve both names to the existing directory.
  // The native junction test above covers the Windows-specific tree hazard.
  const inventory = () => inspectReleaseFiles(f.root);
  if (process.platform !== 'win32') await expect(inventory()).rejects.toThrow();
  else expect(await inventory()).toHaveLength(1);
});
test('bounded publisher inputs reject trailing oversized data', async () => {
  const f = await fixture();
  const input = join(f.directory, 'input.json');
  await writeFile(input, 'a'.repeat(100));
  expect((await readBounded(input, 100)).length).toBe(100);
  await expect(readBounded(input, 99)).rejects.toThrow();
});
test('release signing CLI uses encrypted external keys without overwriting or exposing secrets', async () => {
  const f = await fixture();
  const key = join(f.directory, 'ephemeral.key');
  const metadata = join(f.directory, 'metadata.json');
  const trust = join(f.directory, 'trust.json');
  const passphrase = 'ephemeral-release-cli-only';
  await writeFile(
    key,
    f.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase,
    }),
    { mode: 0o600 },
  );
  await writeFile(metadata, JSON.stringify(f.metadata));
  await writeFile(trust, JSON.stringify(f.trust));
  const args = [
    '--import',
    'tsx',
    resolve('scripts/issuer/release-cli.ts'),
    '--root',
    f.root,
    '--metadata',
    metadata,
    '--key-file',
    key,
    '--key-id',
    f.keyId,
    '--trust',
    trust,
  ];
  const invoke = () =>
    promisify(execFile)(process.execPath, args, {
      env: { ...process.env, ISSUER_KEY_PASSPHRASE: passphrase },
      timeout: 15000,
    });
  const result = JSON.parse((await invoke()).stdout);
  expect(result).toEqual({
    event: 'release_signed',
    version: '1.1.0',
    files: 1,
  });
  try {
    await invoke();
    throw new Error('Expected failure');
  } catch (error) {
    expect(error).toMatchObject({ code: 1, stdout: '' });
    expect((error as { stderr: string }).stderr).not.toContain(passphrase);
    expect((error as { stderr: string }).stderr).not.toContain(f.directory);
  }
}, 30000);
