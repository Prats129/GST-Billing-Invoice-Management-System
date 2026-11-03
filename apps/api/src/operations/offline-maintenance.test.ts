import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  writeFile,
  appendFile,
  rm,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { certificateHash } from './certificate-probe.js';
import {
  runOfflineMaintenance,
  inspectOfflineMaintenance,
  recoverOfflineMaintenance,
} from './offline-maintenance.js';
import type { OfflineMaintenanceHost } from './offline-maintenance.js';
vi.setConfig({ testTimeout: 30000 });
const parent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(parent) ||
      !basename(root).startsWith('gst-offline-maintenance-')
    )
      throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(parent, 'gst-offline-maintenance-'));
  roots.push(root);
  const options = {
    parent: root,
    installationId: randomUUID(),
    version: '1.0.0',
    binding: 'a'.repeat(64),
    repairConfiguration: { fixture: true },
  };
  const state = { fail: false, alive: false, busy: false, effects: 0 };
  const host: OfflineMaintenanceHost = {
    async inspect() {
      return { fingerprint: 'b'.repeat(64), actorAlive: state.alive };
    },
    async run(request) {
      if (state.busy) throw new Error('Execution guard busy');
      state.busy = true;
      try {
        const file = join(
          root,
          'gst-update-' + request.operationId,
          'native-permit.json',
        );
        if (certificateHash(await readFile(file)) !== request.permitSha256)
          throw new Error('Superseded operator');
        if (request.replacementPermit)
          await writeFile(file, request.replacementPermit);
        state.effects++;
        if (state.fail) throw new Error('Injected interrupted native work');
      } finally {
        state.busy = false;
      }
    },
  };
  const operation = async () =>
    JSON.parse(
      await readFile(join(root, 'gst-update.lock', 'owner.json'), 'utf8'),
    ).operationId as string;
  const interrupt = async (action: 'repair' | 'uninstall' = 'uninstall') => {
    state.fail = true;
    await expect(
      runOfflineMaintenance(options, action, host),
    ).rejects.toThrow();
    state.fail = false;
    return operation();
  };
  return { root, options, state, host, interrupt, operation };
}
test('successful uninstall releases shared lock and retains distinct durable intent', async () => {
  const f = await fixture();
  const result = await runOfflineMaintenance(f.options, 'uninstall', f.host);
  expect(f.state.effects).toBe(1);
  expect(await readdir(f.root)).not.toContain('gst-update.lock');
  const intent = JSON.parse(
    await readFile(
      join(f.root, 'gst-update-' + result.operationId, 'offline-intent.json'),
      'utf8',
    ),
  );
  expect(intent).toMatchObject({
    kind: 'uninstall',
    binding: f.options.binding,
  });
});
test('explicit uninstall recovery rechecks evidence and archives the resolved lock', async () => {
  const f = await fixture(),
    id = await f.interrupt();
  const snapshot = await inspectOfflineMaintenance(f.options, id, f.host);
  const result = await recoverOfflineMaintenance(f.options, id, f.host, {
    installationId: f.options.installationId,
    operatorStopped: true,
    expectedFingerprint: snapshot.fingerprint,
  });
  expect(result.kind).toBe('uninstall');
  expect(await readdir(f.root)).not.toContain('gst-update.lock');
  expect(
    (await readdir(join(f.root, 'gst-update-' + id))).some((name) =>
      name.startsWith('resolved-lock-'),
    ),
  ).toBe(true);
});
test('torn final journal record is preserved while idempotent recovery writes separate evidence', async () => {
  const f = await fixture(),
    id = await f.interrupt('repair'),
    events = join(f.root, 'gst-update-' + id, 'events.jsonl');
  await appendFile(events, '{"phase":');
  const before = await readFile(events);
  const snapshot = await inspectOfflineMaintenance(f.options, id, f.host);
  await recoverOfflineMaintenance(f.options, id, f.host, {
    installationId: f.options.installationId,
    operatorStopped: true,
    expectedFingerprint: snapshot.fingerprint,
  });
  expect(await readFile(events)).toEqual(before);
});
test('live operator, missing confirmation and changed binding fail before native mutation', async () => {
  const f = await fixture(),
    id = await f.interrupt();
  const snapshot = await inspectOfflineMaintenance(f.options, id, f.host),
    count = f.state.effects;
  const confirmation = {
    installationId: f.options.installationId,
    operatorStopped: true,
    expectedFingerprint: snapshot.fingerprint,
  };
  await expect(
    recoverOfflineMaintenance(f.options, id, f.host, {
      ...confirmation,
      operatorStopped: false,
    }),
  ).rejects.toThrow();
  await expect(
    recoverOfflineMaintenance(f.options, id, f.host, {
      ...confirmation,
      installationId: randomUUID(),
    }),
  ).rejects.toThrow();
  f.state.alive = true;
  await expect(
    recoverOfflineMaintenance(f.options, id, f.host, confirmation),
  ).rejects.toThrow();
  f.state.alive = false;
  await expect(
    recoverOfflineMaintenance(
      { ...f.options, binding: 'c'.repeat(64) },
      id,
      f.host,
      confirmation,
    ),
  ).rejects.toThrow();
  expect(f.state.effects).toBe(count);
});
test('stale journal inspection and foreign lock identity are refused', async () => {
  const f = await fixture(),
    id = await f.interrupt(),
    snapshot = await inspectOfflineMaintenance(f.options, id, f.host),
    count = f.state.effects;
  await appendFile(join(f.root, 'gst-update-' + id, 'events.jsonl'), ' ');
  await expect(
    recoverOfflineMaintenance(f.options, id, f.host, {
      installationId: f.options.installationId,
      operatorStopped: true,
      expectedFingerprint: snapshot.fingerprint,
    }),
  ).rejects.toThrow();
  const owner = join(f.root, 'gst-update.lock', 'owner.json');
  const value = JSON.parse(await readFile(owner, 'utf8'));
  value.installationId = randomUUID();
  await writeFile(owner, JSON.stringify(value));
  await expect(
    inspectOfflineMaintenance(f.options, id, f.host),
  ).rejects.toThrow();
  expect(f.state.effects).toBe(count);
});
test('failed recovery retains the lock and can be retried only using a new inspection', async () => {
  const f = await fixture(),
    id = await f.interrupt();
  const snapshot = await inspectOfflineMaintenance(f.options, id, f.host);
  f.state.fail = true;
  await expect(
    recoverOfflineMaintenance(f.options, id, f.host, {
      installationId: f.options.installationId,
      operatorStopped: true,
      expectedFingerprint: snapshot.fingerprint,
    }),
  ).rejects.toThrow();
  f.state.fail = false;
  const newer = await inspectOfflineMaintenance(f.options, id, f.host);
  expect(newer.fingerprint).not.toBe(snapshot.fingerprint);
  await expect(
    recoverOfflineMaintenance(f.options, id, f.host, {
      installationId: f.options.installationId,
      operatorStopped: true,
      expectedFingerprint: snapshot.fingerprint,
    }),
  ).rejects.toThrow();
  await recoverOfflineMaintenance(f.options, id, f.host, {
    installationId: f.options.installationId,
    operatorStopped: true,
    expectedFingerprint: newer.fingerprint,
  });
  expect(await readdir(f.root)).not.toContain('gst-update.lock');
});
test('two recovery claims cannot both perform native work from the same inspection', async () => {
  const f = await fixture(),
    id = await f.interrupt(),
    snapshot = await inspectOfflineMaintenance(f.options, id, f.host),
    before = f.state.effects;
  const result = await Promise.allSettled(
    [1, 2].map(() =>
      recoverOfflineMaintenance(f.options, id, f.host, {
        installationId: f.options.installationId,
        operatorStopped: true,
        expectedFingerprint: snapshot.fingerprint,
      }),
    ),
  );
  expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(f.state.effects).toBe(before + 1);
});
