import { generateKeyPairSync, createHash, randomUUID, sign } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { assertUpdateEligibility } from './update-eligibility.js';
import { AssistedUpdateError, runAssistedUpdate } from './assisted-update.js';
import type { UpdateHost, UpdateRecord } from './assisted-update.js';
import { acquireUpdateJournal } from './update-journal.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trust = loadEntitlementTrust({
  test: publicKey.export({ type: 'spki', format: 'pem' }),
});
const temporary: string[] = [];
const fixtureParent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(fixtureParent) ||
      !basename(target).startsWith('gst-update-test-')
    )
      throw new Error('Unsafe test cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(fixtureParent, 'gst-update-test-'));
  temporary.push(directory);
  const contents = 'signed application fixture';
  await writeFile(join(directory, 'app.js'), contents);
  const manifest = {
    format: 1,
    version: '1.1.0',
    minimumInstalledVersion: '1.0.0',
    fromSchemaDigest: 'a'.repeat(64),
    toSchemaDigest: 'b'.repeat(64),
    nodeMajor: 24,
    postgresMajor: 18,
    files: [
      {
        path: 'app.js',
        bytes: Buffer.byteLength(contents),
        sha256: createHash('sha256').update(contents).digest('hex'),
      },
    ],
  };
  const payload = Buffer.from(JSON.stringify(manifest)).toString('base64url');
  await writeFile(
    join(directory, 'release.json'),
    JSON.stringify({
      keyId: 'test',
      payload,
      signature: sign(
        null,
        Buffer.from(`GST-RELEASE-V1\ntest\n${payload}`),
        privateKey,
      ).toString('base64url'),
    }),
  );
  const installationId = randomUUID();
  const records: UpdateRecord[] = [];
  let stopped = false;
  let activated = false;
  let admitted = false;
  let locked = false;
  const backup = {
    reference: 'backup-1',
    installationId,
    schemaDigest: manifest.fromSchemaDigest,
    verified: true as const,
  };
  const candidate = {
    reference: 'gst_recovery_' + 'a'.repeat(32),
    installationId,
    schemaDigest: manifest.toSchemaDigest,
    quarantined: true as const,
    runtimeAccessVerified: true as const,
  };
  const host: UpdateHost = {
    acquire: vi.fn(async () => {
      if (locked) throw new Error();
      locked = true;
      return {
        release: vi.fn(async () => {
          locked = false;
        }),
      };
    }),
    record: vi.fn(async (record) => {
      records.push(record);
    }),
    assertMaintenance: vi.fn(async () => {}),
    stopWriters: vi.fn(async () => {
      stopped = true;
    }),
    backupAndVerify: vi.fn(async () => {
      if (!stopped) throw new Error();
      return backup;
    }),
    prepareCandidate: vi.fn(async () => candidate),
    activate: vi.fn(async () => {
      activated = true;
    }),
    startCandidate: vi.fn(async () => {
      if (!activated) throw new Error();
    }),
    assertReady: vi.fn(async () => {}),
    admitUsers: vi.fn(async () => {
      admitted = true;
      stopped = false;
    }),
    keepStopped: vi.fn(async () => {
      stopped = true;
      admitted = false;
    }),
  };
  const options = {
    operationId: randomUUID(),
    installationId,
    stagedRoot: directory,
    releaseTrust: trust,
    installed: { version: '1.0.0', schemaDigest: manifest.fromSchemaDigest },
    host,
  };
  return {
    host,
    options,
    backup,
    candidate,
    directory,
    records,
    state: () => ({ stopped, activated, admitted, locked }),
  };
}

test('signed candidate completes only after verified backup, migration, readiness and final admission', async () => {
  const f = await fixture();
  const outcome = await runAssistedUpdate(f.options);
  expect(outcome.phase).toBe('completed');
  expect(f.records.map((r) => r.phase)).toEqual([
    'acquired',
    'validated',
    'stopping',
    'stopped',
    'backing_up',
    'preparing',
    'ready_to_switch',
    'switching',
    'starting',
    'validating',
    'completed',
  ]);
  expect(f.host.assertMaintenance).toHaveBeenCalledTimes(3);
  expect(f.host.assertMaintenance).toHaveBeenLastCalledWith(f.candidate);
  expect(f.host.prepareCandidate).toHaveBeenCalledWith(
    f.backup,
    expect.objectContaining({ toSchemaDigest: 'b'.repeat(64) }),
  );
  expect(f.host.keepStopped).not.toHaveBeenCalled();
  expect(f.state()).toEqual({
    stopped: false,
    activated: true,
    admitted: true,
    locked: false,
  });
});

test('unsigned/tampered downloads never stop the existing application', async () => {
  const f = await fixture();
  await writeFile(join(f.directory, 'app.js'), 'changed');
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    recoveryRequired: false,
  });
  expect(f.host.stopWriters).not.toHaveBeenCalled();
  expect(f.host.activate).not.toHaveBeenCalled();
  expect(f.state().locked).toBe(false);
});

test('maintenance expiring during preparation blocks activation using real signed-grant policy', async () => {
  const f = await fixture();
  const organizationId = randomUUID();
  const expires = new Date('2026-11-03T12:00:00Z');
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      entitlementId: randomUUID(),
      organizationId,
      installationId: f.options.installationId,
      sequence: 1,
      issuedAt: '2026-11-01T00:00:00Z',
      startsAt: '2026-11-01T00:00:00Z',
      kind: 'perpetual',
      edition: 'offline',
      expiresAt: null,
      maintenanceUntil: expires.toISOString(),
    }),
  ).toString('base64url');
  const grant = {
    keyId: 'test',
    payload,
    signature: sign(
      null,
      Buffer.from(`GST-ENTITLEMENT-V1\ntest\n${payload}`),
      privateKey,
    ).toString('base64url'),
  };
  let checks = 0;
  f.host.assertMaintenance = vi.fn(async () => {
    checks++;
    assertUpdateEligibility(
      [
        {
          id: organizationId,
          edition: 'offline',
          entitlement: {
            signedGrant: grant,
            highestSequence: 1,
            lastObservedAt: new Date('2026-11-01T00:00:00Z'),
          },
        },
      ],
      trust,
      f.options.installationId,
      new Date(expires.getTime() - (checks < 3 ? 1 : 0)),
    );
  });
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    phase: 'switching',
    recoveryRequired: true,
    stopConfirmed: true,
  });
  expect(f.host.activate).not.toHaveBeenCalled();
  expect(f.state().stopped).toBe(true);
});

test('rechecks staged file integrity after slow restore/migration work', async () => {
  const f = await fixture();
  f.host.prepareCandidate = vi.fn(async () => {
    await writeFile(join(f.directory, 'app.js'), 'replacement');
    return f.candidate;
  });
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    phase: 'ready_to_switch',
  });
  expect(f.host.activate).not.toHaveBeenCalled();
  expect(f.host.keepStopped).toHaveBeenCalledOnce();
});

test.each(['backup', 'candidate'] as const)(
  'rejects wrong-host/wrong-schema %s receipts before activation',
  async (which) => {
    const f = await fixture();
    if (which === 'backup') f.backup.installationId = randomUUID();
    else f.candidate.schemaDigest = 'c'.repeat(64);
    await expect(runAssistedUpdate(f.options)).rejects.toBeInstanceOf(
      AssistedUpdateError,
    );
    expect(f.host.activate).not.toHaveBeenCalled();
    expect(f.state().stopped).toBe(true);
  },
);

test.each([
  'stopWriters',
  'backupAndVerify',
  'prepareCandidate',
  'activate',
  'startCandidate',
  'assertReady',
  'admitUsers',
] as const)(
  'failure in %s keeps writers stopped and preserves recovery artifacts',
  async (step) => {
    const f = await fixture();
    f.host[step] = vi.fn(async () => {
      throw new Error('private connection password must not escape');
    }) as never;
    let caught: unknown;
    try {
      await runAssistedUpdate(f.options);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      recoveryRequired: true,
      stopConfirmed: true,
      failureRecorded: true,
    });
    expect(String(caught)).not.toContain('password');
    expect(f.records.at(-1)?.phase).toBe('recovery_required');
    expect(f.state().stopped).toBe(true);
    expect(f.state().admitted).toBe(false);
  },
);

test('uncertain activation never invokes an automatic downgrade or second activation', async () => {
  const f = await fixture();
  let committed = false;
  f.host.activate = vi.fn(async () => {
    committed = true;
    throw new Error('Lost commit reply');
  });
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    phase: 'switching',
  });
  expect(committed).toBe(true);
  expect(f.host.activate).toHaveBeenCalledOnce();
  expect(f.host.startCandidate).not.toHaveBeenCalled();
});

test('journal failure before activation prevents switching even after candidate preparation', async () => {
  const f = await fixture();
  f.host.record = vi.fn(async (r) => {
    if (r.phase === 'switching') throw new Error();
    f.records.push(r);
  });
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    failureRecorded: true,
  });
  expect(f.host.activate).not.toHaveBeenCalled();
});

test('failed shutdown and failed journal are reported instead of false recovery assurance', async () => {
  const f = await fixture();
  f.host.activate = vi.fn(async () => {
    throw new Error();
  });
  f.host.keepStopped = vi.fn(async () => {
    throw new Error();
  });
  f.host.record = vi.fn(async (r) => {
    if (r.phase === 'recovery_required') throw new Error();
    f.records.push(r);
  });
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    stopConfirmed: false,
    failureRecorded: false,
  });
});

test('failed lock release cannot report successful installation', async () => {
  const f = await fixture();
  f.host.acquire = vi.fn(async () => ({
    release: async () => {
      throw new Error();
    },
  }));
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    recoveryRequired: true,
    stopConfirmed: true,
  });
  expect(f.state().admitted).toBe(false);
});

test('concurrent operation is rejected while the first operation holds its host lock', async () => {
  const f = await fixture();
  let proceed!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((done) => {
    proceed = done;
  });
  const started = new Promise<void>((done) => {
    reached = done;
  });
  f.host.backupAndVerify = vi.fn(async () => {
    reached();
    await gate;
    return f.backup;
  });
  const first = runAssistedUpdate(f.options);
  await started;
  try {
    await expect(
      runAssistedUpdate({ ...f.options, operationId: randomUUID() }),
    ).rejects.toMatchObject({ recoveryRequired: false });
    expect(f.host.keepStopped).not.toHaveBeenCalled();
  } finally {
    proceed();
  }
  await expect(first).resolves.toMatchObject({ phase: 'completed' });
});

test('uncertain activation persists a real recovery journal and blocks a later operation', async () => {
  const f = await fixture();
  const journalParent = await mkdtemp(
    join(fixtureParent, 'gst-update-test-journal-'),
  );
  temporary.push(journalParent);
  let journal: Awaited<ReturnType<typeof acquireUpdateJournal>> | undefined;
  f.host.acquire = async () => {
    journal = await acquireUpdateJournal(
      journalParent,
      f.options.installationId,
      f.options.operationId,
    );
    return journal;
  };
  f.host.record = async (value) => {
    if (!journal) throw new Error();
    await journal.record(value);
  };
  f.host.activate = async () => {
    throw new Error('Uncertain commit');
  };
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    recoveryRequired: true,
    failureRecorded: true,
  });
  expect(journal).toBeDefined();
  const rows = (
    await readFile(join(journal!.directory, 'events.jsonl'), 'utf8')
  )
    .trim()
    .split('\n')
    .map((row) => JSON.parse(row));
  expect(rows.at(-1).phase).toBe('recovery_required');
  await expect(
    acquireUpdateJournal(journalParent, f.options.installationId, randomUUID()),
  ).rejects.toThrow();
}, 30000);
