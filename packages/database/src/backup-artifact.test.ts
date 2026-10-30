import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { decryptBackup, encryptBackup } from './backup-artifact.js';

const directories: string[] = [];
afterEach(async () => {
  for (const d of directories.splice(0))
    await rm(d, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gst-backup-test-'));
  directories.push(dir);
  const source = join(dir, 'source.dump'),
    artifact = join(dir, 'backup.gstbackup'),
    restored = join(dir, 'restored.dump');
  const data = Buffer.concat([Buffer.from('PGDMP'), randomBytes(200000)]);
  await writeFile(source, data);
  const key = randomBytes(32),
    identity = { installationId: randomUUID(), schemaDigest: 'ab'.repeat(32) };
  return { dir, source, artifact, restored, data, key, identity };
}
test(
  'authenticated backup round trip, unique nonce, and no overwrite',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    const metadata = await encryptBackup(
      f.source,
      f.artifact,
      f.key,
      f.identity,
    );
    await encryptBackup(f.source, `${f.artifact}.second`, f.key, f.identity);
    expect(await readFile(f.artifact)).not.toEqual(
      await readFile(`${f.artifact}.second`),
    );
    expect(
      await decryptBackup(f.artifact, f.restored, f.key, f.identity),
    ).toEqual(metadata);
    expect(await readFile(f.restored)).toEqual(f.data);
    await expect(
      encryptBackup(f.source, f.artifact, f.key, f.identity),
    ).rejects.toThrow();
    await expect(
      decryptBackup(f.artifact, f.restored, f.key, f.identity),
    ).rejects.toThrow();
    expect(await readFile(f.restored)).toEqual(f.data);
    expect(
      (await readdir(f.dir)).filter((n) => n.endsWith('.partial')),
    ).toEqual([]);
  },
);
test('wrong key, installation and schema cannot publish decrypted data', async () => {
  const f = await fixture();
  await encryptBackup(f.source, f.artifact, f.key, f.identity);
  for (const [key, identity] of [
    [randomBytes(32), f.identity],
    [f.key, { ...f.identity, installationId: randomUUID() }],
    [f.key, { ...f.identity, schemaDigest: 'cd'.repeat(32) }],
  ] as const) {
    await expect(
      decryptBackup(f.artifact, f.restored, key, identity),
    ).rejects.toThrow();
    expect(await readdir(f.dir)).toEqual(
      expect.not.arrayContaining(['restored.dump']),
    );
  }
  expect((await readdir(f.dir)).filter((n) => n.endsWith('.partial'))).toEqual(
    [],
  );
});
test('corruption of metadata, ciphertext, tag and truncation fails closed', async () => {
  const f = await fixture();
  await encryptBackup(f.source, f.artifact, f.key, f.identity);
  const original = await readFile(f.artifact);
  for (const offset of [0, 10, 25, original.length - 20, original.length - 1]) {
    const changed = Buffer.from(original);
    changed[offset] = changed[offset]! ^ 1;
    await writeFile(`${f.artifact}.bad`, changed);
    await expect(
      decryptBackup(`${f.artifact}.bad`, f.restored, f.key, f.identity),
    ).rejects.toThrow();
  }
  await writeFile(
    `${f.artifact}.bad`,
    original.subarray(0, original.length - 10),
  );
  await expect(
    decryptBackup(`${f.artifact}.bad`, f.restored, f.key, f.identity),
  ).rejects.toThrow();
  expect(
    (await readdir(f.dir)).some(
      (n) => n === 'restored.dump' || n.endsWith('.partial'),
    ),
  ).toBe(false);
});
test('reject non-custom archives and invalid keys before publishing', async () => {
  const f = await fixture();
  await writeFile(f.source, 'not a PostgreSQL custom archive');
  await expect(
    encryptBackup(f.source, f.artifact, f.key, f.identity),
  ).rejects.toThrow();
  await expect(
    encryptBackup(f.source, f.artifact, randomBytes(16), f.identity),
  ).rejects.toThrow();
  expect(await readdir(f.dir)).toEqual(['source.dump']);
});
