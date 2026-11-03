import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { Client } from 'pg';
import {
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  sign,
  createHash,
} from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createIsolatedTestDatabase } from '@gst/database/testing';
import { migrationDigest } from '@gst/database/operations';
import { loadEntitlementTrust } from '../../../apps/api/src/licensing/entitlement.js';
import { runAssistedUpdate } from '../../../apps/api/src/operations/assisted-update.js';
import { createDatabaseUpdateHost } from '../../../apps/api/src/operations/database-update-host.js';
import {
  initializeInstallationState,
  readInstallationState,
} from '../../../apps/api/src/operations/installation-state.js';
import { secureDirectory } from '../../../apps/api/src/operations/release-staging.js';
import {
  inspectFailedUpdate,
  recoverFailedUpdate,
} from '../../../apps/api/src/operations/update-recovery.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const tools = process.env.TEST_BACKUP_DOCKER_CONTAINER
  ? { dockerContainer: process.env.TEST_BACKUP_DOCKER_CONTAINER }
  : process.env.TEST_PG_BIN_DIRECTORY
    ? { pgBinDirectory: process.env.TEST_PG_BIN_DIRECTORY }
    : undefined;
if (!adminUrl || !tools)
  throw new Error('Isolated database admin and PostgreSQL tools required.');
const operator = 'gst_update_op_' + randomUUID().replaceAll('-', '');
const role = 'gst_update_api_' + randomUUID().replaceAll('-', '');
const opPassword = randomBytes(32).toString('hex'),
  apiPassword = randomBytes(32).toString('hex');
const installationId = randomUUID();
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trust = loadEntitlementTrust({
  test: publicKey.export({ type: 'spki', format: 'pem' }),
});
const fixtureParent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
let admin: Client;
let source: Awaited<ReturnType<typeof createIsolatedTestDatabase>> | undefined;
let directory: string | undefined;
let digest: string;
let sourceName: string;
let sourceOid: number;
let runtime: string;
let operatorCreated = false,
  runtimeCreated = false;

beforeAll(async () => {
  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';
  admin = new Client({ connectionString: maintenance.toString() });
  await admin.connect();
  await admin.query(
    `CREATE ROLE "${operator}" LOGIN PASSWORD '${opPassword}' NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  operatorCreated = true;
  await admin.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${apiPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  runtimeCreated = true;
  maintenance.username = operator;
  maintenance.password = opPassword;
  source = await createIsolatedTestDatabase(maintenance.toString());
  sourceName = new URL(source.connectionString).pathname.slice(1);
  sourceOid = (
    await admin.query(
      'SELECT oid::int AS oid FROM pg_database WHERE datname=$1',
      [sourceName],
    )
  ).rows[0].oid;
  const url = new URL(source.connectionString);
  url.username = role;
  url.password = apiPassword;
  runtime = url.toString();
  const db = new Client({ connectionString: source.connectionString });
  await db.connect();
  try {
    const now = new Date(Date.now() - 1000).toISOString();
    for (const status of ['archived', 'suspended']) {
      const id = randomUUID();
      await db.query(
        'INSERT INTO public.organizations(id,name,status,edition) VALUES($1,$2,$3,$4)',
        [id, 'Update fixture', status, 'offline'],
      );
      const payload = Buffer.from(
        JSON.stringify({
          version: 1,
          entitlementId: randomUUID(),
          organizationId: id,
          installationId,
          sequence: 1,
          issuedAt: now,
          startsAt: now,
          expiresAt: null,
          maintenanceUntil: new Date(Date.now() + 86400000).toISOString(),
          kind: 'perpetual',
          edition: 'offline',
        }),
      ).toString('base64url');
      await db.query(
        'INSERT INTO public.organization_entitlements(organization_id,signed_grant,highest_sequence,last_observed_at) VALUES($1,$2::jsonb,1,$3)',
        [
          id,
          JSON.stringify({
            keyId: 'test',
            payload,
            signature: sign(
              null,
              Buffer.from(`GST-ENTITLEMENT-V1\ntest\n${payload}`),
              privateKey,
            ).toString('base64url'),
          }),
          now,
        ],
      );
    }
    await db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`);
  } finally {
    await db.end();
  }
  directory = await mkdtemp(join(fixtureParent, 'gst-update-adapter-test-'));
  for (const folder of ['package', 'original', 'next', 'unsupported'])
    await mkdir(join(directory, folder));
  await mkdir(join(directory, 'journals'));
  await secureDirectory(join(directory, 'journals'));
  digest = await migrationDigest();
  await packageManifest(digest);
  await packageManifest(digest, 'original', '1.0.0', '0.9.0');
  await initializeInstallationState(join(directory, 'journals'), {
    format: 1,
    installationId,
    version: '1.0.0',
    schemaDigest: digest,
    appRoot: join(directory, 'original'),
    operationId: null,
  });
}, 120000);

async function packageManifest(
  target: string,
  folder = 'package',
  releaseVersion = '1.1.0',
  minimum = '1.0.0',
) {
  const contents = 'signed fixture; never execute';
  await writeFile(join(directory!, folder, 'app.js'), contents);
  const payload = Buffer.from(
    JSON.stringify({
      format: 1,
      version: releaseVersion,
      minimumInstalledVersion: minimum,
      fromSchemaDigest: digest,
      toSchemaDigest: target,
      nodeMajor: 24,
      postgresMajor: 18,
      files: [
        {
          path: 'app.js',
          bytes: Buffer.byteLength(contents),
          sha256: createHash('sha256').update(contents).digest('hex'),
        },
      ],
    }),
  ).toString('base64url');
  await writeFile(
    join(directory!, folder, 'release.json'),
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
}
async function fixture(folder = 'package') {
  const service = {
    stop: vi.fn(async () => {}),
    selectRelease: vi.fn(async () => {}),
    startPrivate: vi.fn(async () => {}),
    assertReady: vi.fn(async () => {}),
    admit: vi.fn(async () => {}),
  };
  const operationId = randomUUID();
  const current = await readInstallationState(join(directory!, 'journals'));
  const installed = { version: current.version, schemaDigest: digest };
  const stagedRoot = join(directory!, folder);
  const host = createDatabaseUpdateHost({
    operationId,
    installationId,
    journalParent: join(directory!, 'journals'),
    stagedRoot,
    installedRoot: current.appRoot,
    installed,
    backup: {
      connectionString: source!.connectionString,
      installationId,
      key: Buffer.alloc(32, 47),
      workDirectory: join(directory!, 'work'),
      ...tools!,
    },
    runtimeConnectionString: runtime,
    entitlementTrust: trust,
    releaseTrust: trust,
    service,
  });
  return {
    service,
    operationId,
    recovery: {
      operationId,
      installationId,
      journalParent: join(directory!, 'journals'),
      installedRoot: current.appRoot,
      stagedRoot,
      installed,
      connectionString: source!.connectionString,
      runtimeConnectionString: runtime,
      releaseTrust: trust,
    },
    options: {
      operationId,
      installationId,
      stagedRoot,
      releaseTrust: trust,
      installed,
      host,
    },
  };
}

test('bound adapter backs up, restores, checks maintenance, provisions and switches a real database retaining the original', async () => {
  const f = await fixture();
  expect(await runAssistedUpdate(f.options)).toMatchObject({
    phase: 'completed',
  });
  for (const method of Object.values(f.service))
    expect(method).toHaveBeenCalledOnce();
  const recordRoot = join(
    directory!,
    'journals',
    'gst-update-' + f.operationId,
  );
  const intent = JSON.parse(
    await readFile(join(recordRoot, 'cutover-intent.json'), 'utf8'),
  );
  const result = JSON.parse(
    await readFile(join(recordRoot, 'cutover-result.json'), 'utf8'),
  );
  expect(
    intent.databases.some((row: { oid: number }) => row.oid === sourceOid),
  ).toBe(true);
  expect(result.retainedOid).toBe(sourceOid);
  expect(result.activeOid).not.toBe(sourceOid);
  expect(result.activeDatabase).toBe(sourceName);
  const retained = (
    await admin.query('SELECT datallowconn FROM pg_database WHERE oid=$1', [
      sourceOid,
    ])
  ).rows[0];
  expect(retained.datallowconn).toBe(false);
  const api = new Client({ connectionString: runtime });
  await api.connect();
  try {
    expect(
      (
        await api.query(
          'SELECT count(*)::int AS count FROM public.organizations',
        )
      ).rows[0].count,
    ).toBe(2);
    await expect(
      api.query(
        'UPDATE public.organization_entitlements SET highest_sequence=2',
      ),
    ).rejects.toThrow();
  } finally {
    await api.end();
  }
  const log = await readFile(join(recordRoot, 'events.jsonl'), 'utf8');
  expect(log).toContain('completed');
  expect(log).not.toContain(opPassword);
  expect(log).not.toContain(apiPassword);
}, 120000);

test('guided recovery restores the original database/release state after an admission failure', async () => {
  await packageManifest(digest, 'next', '1.2.0', '1.1.0');
  const f = await fixture('next');
  f.service.admit.mockRejectedValueOnce(
    new Error('Admission failed after cutover'),
  );
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    recoveryRequired: true,
  });
  expect(await readInstallationState(f.recovery.journalParent)).toMatchObject({
    version: '1.2.0',
  });
  expect(await inspectFailedUpdate(f.recovery)).toMatchObject({
    state: 'activated',
  });
  const service = {
    stop: vi.fn(async () => {}),
    restoreOriginal: vi.fn(async () => {}),
    startOriginal: vi.fn(async () => {}),
    assertOriginalReady: vi.fn(async () => {}),
    admitOriginal: vi.fn(async () => {}),
  };
  await expect(
    recoverFailedUpdate(f.recovery, service, {
      updaterStopped: false,
      installationId,
      acceptRecoveryPoint: true,
    }),
  ).rejects.toThrow();
  expect(service.stop).not.toHaveBeenCalled();
  await expect(
    recoverFailedUpdate(f.recovery, service, {
      updaterStopped: true,
      installationId,
      acceptRecoveryPoint: true,
    }),
  ).resolves.toMatchObject({ state: 'original_restored' });
  expect(await readInstallationState(f.recovery.journalParent)).toMatchObject({
    version: '1.1.0',
    appRoot: f.recovery.installedRoot,
  });
  expect(service.restoreOriginal).toHaveBeenCalledOnce();
}, 120000);

test('schema-changing signed releases fail before native stop or backup', async () => {
  await packageManifest('f'.repeat(64), 'unsupported', '1.2.0', '1.1.0');
  const f = await fixture('unsupported');
  await expect(runAssistedUpdate(f.options)).rejects.toMatchObject({
    recoveryRequired: false,
  });
  expect(f.service.stop).not.toHaveBeenCalled();
});

async function removeFixture(root: string) {
  const target = resolve(root);
  if (
    dirname(target) !== resolve(fixtureParent) ||
    !basename(target).startsWith('gst-update-adapter-test-')
  )
    throw new Error('Unsafe fixture path.');
  await rm(target, { recursive: true, force: true });
}

afterAll(async () => {
  try {
    await source?.cleanup();
    if (operatorCreated) {
      const databases = await admin.query(
        'SELECT datname FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=$1)',
        [operator],
      );
      for (const row of databases.rows) {
        if (!/^gst_(test|recovery|previous)_[a-f0-9]{32}$/.test(row.datname))
          throw new Error('Refusing unrelated fixture cleanup.');
        await admin.query(`DROP DATABASE "${row.datname}" WITH (FORCE)`);
      }
    }
    if (runtimeCreated) await admin.query(`DROP ROLE "${role}"`);
    if (operatorCreated) await admin.query(`DROP ROLE "${operator}"`);
  } finally {
    await admin?.end();
    if (directory) await removeFixture(directory);
  }
}, 120000);
