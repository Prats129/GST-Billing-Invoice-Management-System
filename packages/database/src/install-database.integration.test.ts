import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { initializeOfflineDatabase } from './install-database.js';
import {
  assertRuntimePrivileges,
  assertRuntimeRole,
} from './runtime-access.js';

const enabled = process.env.TEST_OFFLINE_INSTALL_DOCKER === '1';
const execute = promisify(execFile);
const label = randomUUID();
let container: string | undefined;
let connectionString: string;
let directory: string;
const adminPassword = randomBytes(32).toString('hex');
const ownerPassword = randomBytes(32).toString('hex');
const runtimePassword = randomBytes(32).toString('hex');
const installationId = randomUUID();
const docker = (args: string[]) =>
  execute('docker', args, {
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 16384,
    env: { ...process.env, POSTGRES_PASSWORD: adminPassword },
  });
beforeAll(async () => {
  if (!enabled) return;
  // New anonymous container/volume only. Never attach the configured dev DB.
  container = (
    await docker([
      'run',
      '--detach',
      '--pull=never',
      '--label',
      'gst-installer-test=' + label,
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_USER=gst_cluster_admin',
      '-e',
      'POSTGRES_DB=postgres',
      '-p',
      '127.0.0.1::5432',
      'postgres:18.6',
    ])
  ).stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(container))
    throw new Error('Unexpected fixture identity');
  const port = JSON.parse((await docker(['inspect', container])).stdout)[0]
    .NetworkSettings.Ports['5432/tcp'][0].HostPort;
  connectionString = `postgresql://gst_cluster_admin:${adminPassword}@127.0.0.1:${port}/postgres`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const db = new Client({ connectionString, connectionTimeoutMillis: 1000 });
    try {
      await db.connect();
      directory = (await db.query('SHOW data_directory')).rows[0]
        .data_directory;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      await db.end();
    }
  }
  throw new Error('Disposable installer database did not start');
}, 60000);
afterAll(async () => {
  if (!container) return;
  // Verify ownership before deleting precisely this container and its anonymous
  // volume. No paths, named volumes, other containers or customer data involved.
  const info = JSON.parse((await docker(['inspect', container])).stdout)[0];
  if (
    info.Id !== container ||
    info.Config.Labels['gst-installer-test'] !== label
  )
    throw new Error('Unsafe fixture cleanup');
  await docker(['rm', '--force', '--volumes', container]);
}, 60000);

test.skipIf(!enabled)(
  'fresh cluster identity guards, migrations, runtime policy and repeat refusal',
  async () => {
    const options = {
      adminConnectionString: connectionString,
      expectedDataDirectory: directory,
      installationId,
      ownerPassword,
      runtimePassword,
    };
    await expect(
      initializeOfflineDatabase({
        ...options,
        expectedDataDirectory: directory + '/wrong',
      }),
    ).rejects.toThrow('Initial database provisioning failed');
    await expect(
      initializeOfflineDatabase({ ...options, runtimePassword: ownerPassword }),
    ).rejects.toThrow();
    const admin = new Client({ connectionString });
    await admin.connect();
    try {
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS count FROM pg_roles WHERE rolname IN ('gst_owner','gst_runtime')",
          )
        ).rows[0].count,
      ).toBe(0);
      await admin.query('CREATE ROLE installer_collision_fixture');
      await expect(initializeOfflineDatabase(options)).rejects.toThrow();
      await admin.query('DROP ROLE installer_collision_fixture');
      const result = await initializeOfflineDatabase(options);
      expect(result).toMatchObject({
        database: 'gst_billing',
        schemaDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        systemIdentifier: expect.stringMatching(/^\d+$/),
      });
      const ownerUrl = new URL(connectionString);
      ownerUrl.username = 'gst_owner';
      ownerUrl.password = ownerPassword;
      ownerUrl.pathname = '/gst_billing';
      const owner = new Client({ connectionString: ownerUrl.toString() });
      await owner.connect();
      try {
        await assertRuntimeRole(owner, 'gst_runtime');
        await assertRuntimePrivileges(owner, 'gst_runtime', true);
        expect(
          (
            await owner.query(
              "SELECT metadata->>'installationId' AS id FROM audit_events WHERE action='installation.database_initialized'",
            )
          ).rows,
        ).toEqual([{ id: installationId }]);
      } finally {
        await owner.end();
      }
      const runtimeUrl = new URL(ownerUrl);
      runtimeUrl.username = 'gst_runtime';
      runtimeUrl.password = runtimePassword;
      const runtime = new Client({ connectionString: runtimeUrl.toString() });
      await runtime.connect();
      try {
        await expect(
          runtime.query(
            'CREATE TABLE public.forbidden_install_fixture(id int)',
          ),
        ).rejects.toThrow();
      } finally {
        await runtime.end();
      }
      await expect(initializeOfflineDatabase(options)).rejects.toThrow();
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS count FROM pg_database WHERE datname='gst_billing'",
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await admin.end();
    }
  },
  60000,
);
