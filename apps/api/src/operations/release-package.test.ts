import { afterEach, expect, test } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { verifyReleasePackage } from './release-package.js';
import type { ReleaseManifest } from './release-package.js';

const directories: string[] = [];
afterEach(async () => {
  for (const d of directories.splice(0))
    await rm(d, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gst-release-test-'));
  directories.push(root);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const trust = loadEntitlementTrust({
    release: publicKey.export({ type: 'spki', format: 'pem' }),
  });
  const content = Buffer.from('signed-release-test-fixture');
  await writeFile(join(root, 'application.js'), content);
  const manifest: ReleaseManifest = {
    format: 1,
    version: '1.1.0',
    minimumInstalledVersion: '1.0.0',
    fromSchemaDigest: 'ab'.repeat(32),
    toSchemaDigest: 'cd'.repeat(32),
    nodeMajor: 24,
    postgresMajor: 18,
    files: [
      {
        path: 'application.js',
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      },
    ],
  };
  const save = async (value: unknown = manifest, domain = 'GST-RELEASE-V1') => {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    await writeFile(
      join(root, 'release.json'),
      JSON.stringify({
        keyId: 'release',
        payload,
        signature: sign(
          null,
          Buffer.from(`${domain}\nrelease\n${payload}`),
          privateKey,
        ).toString('base64url'),
      }),
    );
  };
  await save();
  return {
    root,
    trust,
    manifest,
    save,
    installed: { version: '1.0.0', schemaDigest: 'ab'.repeat(32) },
  };
}
test('a valid signed release is verified without executing package contents', async () => {
  const f = await fixture();
  expect(await verifyReleasePackage(f.root, f.trust, f.installed)).toEqual(
    f.manifest,
  );
});
test('changed/missing/unexpected files and another signature domain are rejected', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'unexpected.js'), 'extra');
  await expect(
    verifyReleasePackage(f.root, f.trust, f.installed),
  ).rejects.toThrow();
  await rm(join(f.root, 'unexpected.js'));
  await writeFile(join(f.root, 'application.js'), 'tampered');
  await expect(
    verifyReleasePackage(f.root, f.trust, f.installed),
  ).rejects.toThrow();
  await rm(join(f.root, 'application.js'));
  await expect(
    verifyReleasePackage(f.root, f.trust, f.installed),
  ).rejects.toThrow();
  await f.save(f.manifest, 'GST-ENTITLEMENT-V1');
  await expect(
    verifyReleasePackage(f.root, f.trust, f.installed),
  ).rejects.toThrow();
});

test('directory junctions or symlinks cannot escape the staged package', async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'gst-release-outside-'));
  directories.push(outside);
  await symlink(
    outside,
    join(f.root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(
    verifyReleasePackage(f.root, f.trust, f.installed),
  ).rejects.toThrow();
});
test('rollback, incompatible schema/version and untrusted keys fail closed', async () => {
  const f = await fixture();
  for (const installed of [
    { ...f.installed, version: '1.1.0' },
    { ...f.installed, version: '0.9.0' },
    { ...f.installed, schemaDigest: 'ef'.repeat(32) },
  ])
    await expect(
      verifyReleasePackage(f.root, f.trust, installed),
    ).rejects.toThrow();
  await expect(
    verifyReleasePackage(f.root, new Map(), f.installed),
  ).rejects.toThrow();
});
test('signed path traversal, Windows reserved names, alternate streams and case collisions are rejected', async () => {
  const f = await fixture();
  for (const path of [
    '../outside',
    '/absolute',
    'C:/outside',
    'a\\b',
    'application.js:payload',
    'CON.txt',
    'dir/file.',
    'private.key',
    'RELEASE.JSON',
  ]) {
    await f.save({ ...f.manifest, files: [{ ...f.manifest.files[0], path }] });
    await expect(
      verifyReleasePackage(f.root, f.trust, f.installed),
    ).rejects.toThrow();
  }
  await f.save({
    ...f.manifest,
    files: [
      ...f.manifest.files,
      { ...f.manifest.files[0], path: 'APPLICATION.js' },
    ],
  });
  await expect(
    verifyReleasePackage(f.root, f.trust, f.installed),
  ).rejects.toThrow();
  await f.save();
  await mkdir(join(f.root, 'extra'));
  await writeFile(join(f.root, 'extra', 'hidden.js'), 'extra');
  await expect(
    verifyReleasePackage(f.root, f.trust, f.installed),
  ).rejects.toThrow();
});
