import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, lstat, writeFile } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { acquireUpdateJournal } from './update-journal.js';
import type { UpdateRecord } from './assisted-update.js';

const roots: string[] = [];
// Keep the real ancestor ACL check: sandbox TEMP can grant DeleteChild to
// another identity. Use the same private Windows fixture base as staging tests.
const fixtureParent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const target = resolve(root);
    if (
      dirname(target) !== resolve(fixtureParent) ||
      !basename(target).startsWith('gst-journal-test-')
    )
      throw new Error('Unsafe test cleanup');
    await rm(target, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(fixtureParent, 'gst-journal-test-'));
  roots.push(root);
  const installationId = randomUUID();
  const operationId = randomUUID();
  const lease = await acquireUpdateJournal(root, installationId, operationId);
  const base = { installationId, operationId, version: '1.1.0' };
  return { root, lease, base, installationId, operationId };
}

test('real journal persists ordered records, rejects a competing acquisition and retains completed history', async () => {
  const f = await fixture();
  try {
    await expect(
      acquireUpdateJournal(f.root, f.installationId, randomUUID()),
    ).rejects.toThrow();
    await Promise.all([
      f.lease.record({ ...f.base, phase: 'acquired' }),
      f.lease.record({ ...f.base, phase: 'completed' }),
    ]);
  } finally {
    await f.lease.release();
  }
  const lines = (
    await readFile(join(f.lease.directory, 'events.jsonl'), 'utf8')
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(lines.map((line) => line.phase ?? line.event)).toEqual([
    'update_journal_created',
    'acquired',
    'completed',
  ]);
  await expect(lstat(join(f.root, 'gst-update.lock'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  const next = await acquireUpdateJournal(
    f.root,
    f.installationId,
    randomUUID(),
  );
  await next.release();
  await expect(
    f.lease.record({ ...f.base, phase: 'completed' }),
  ).rejects.toThrow();
}, 30000);

test('incomplete/recovery-required operations retain the cross-process lock after closing', async () => {
  const f = await fixture();
  try {
    await f.lease.record({ ...f.base, phase: 'stopping' });
    await f.lease.record({ ...f.base, phase: 'recovery_required' });
  } finally {
    await f.lease.release();
  }
  expect((await lstat(join(f.root, 'gst-update.lock'))).isDirectory()).toBe(
    true,
  );
  await expect(
    acquireUpdateJournal(f.root, f.installationId, randomUUID()),
  ).rejects.toThrow();
}, 30000);

test('uninstall shares exclusion with updates/certificates and keeps a distinct durable header', async () => {
  const root = await mkdtemp(join(fixtureParent, 'gst-journal-test-'));
  roots.push(root);
  const installationId = randomUUID(),
    operationId = randomUUID();
  const lease = await acquireUpdateJournal(
    root,
    installationId,
    operationId,
    'uninstall',
  );
  try {
    await lease.record({
      installationId,
      operationId,
      version: '1.0.0',
      phase: 'stopping',
    });
    for (const kind of [undefined, 'certificate'] as const)
      await expect(
        acquireUpdateJournal(root, installationId, randomUUID(), kind),
      ).rejects.toThrow();
    const header = JSON.parse(
      (await readFile(join(lease.directory, 'events.jsonl'), 'utf8')).split(
        '\n',
      )[0]!,
    );
    expect(header).toMatchObject({
      operationKind: 'uninstall',
      installationId,
      operationId,
    });
    await lease.record({
      installationId,
      operationId,
      version: '1.0.0',
      phase: 'completed',
    });
  } finally {
    await lease.release();
  }
  await expect(lstat(join(root, 'gst-update.lock'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
}, 30000);

test('journal rejects extra secret-bearing fields and foreign operation IDs', async () => {
  const f = await fixture();
  try {
    await expect(
      f.lease.record({
        ...f.base,
        phase: 'completed',
        password: 'must-not-be-stored',
      } as UpdateRecord),
    ).rejects.toThrow();
    await expect(
      f.lease.record({
        ...f.base,
        phase: 'completed',
        operationId: randomUUID(),
      }),
    ).rejects.toThrow();
    const text = await readFile(
      join(f.lease.directory, 'events.jsonl'),
      'utf8',
    );
    expect(text).not.toContain('must-not-be-stored');
  } finally {
    await f.lease.release();
  }
}, 30000);

test('release refuses a changed owner token and preserves the lock for inspection', async () => {
  const f = await fixture();
  await f.lease.record({ ...f.base, phase: 'completed' });
  await writeFile(join(f.root, 'gst-update.lock', 'owner.json'), '{}');
  await expect(f.lease.release()).rejects.toThrow();
  expect((await lstat(join(f.root, 'gst-update.lock'))).isDirectory()).toBe(
    true,
  );
  await expect(
    acquireUpdateJournal(f.root, f.installationId, randomUUID()),
  ).rejects.toThrow();
}, 30000);
