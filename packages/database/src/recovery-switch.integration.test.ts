import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { Client } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDatabase } from '@gst/database';
import {
  createIsolatedTestDatabase,
  setTestDatabaseToPhase5,
} from '@gst/database/testing';
import {
  createEncryptedBackup,
  prepareRecovery,
  migrationDigest,
} from './backup-operator.js';
import { provisionRecoveryRuntime } from './runtime-access.js';
import {
  recoverySwitchStatus,
  switchRecovery,
  assertRecoveryRuntimeReady,
} from './recovery-switch.js';
import { parseConfig } from '../../../apps/api/src/config.js';
import { IdentityService } from '../../../apps/api/src/security/identity.service.js';
import { OrganizationsService } from '../../../apps/api/src/security/organizations.service.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for isolated recovery-switch tests',
  );
const tools = process.env.TEST_BACKUP_DOCKER_CONTAINER
  ? { dockerContainer: process.env.TEST_BACKUP_DOCKER_CONTAINER }
  : process.env.TEST_PG_BIN_DIRECTORY
    ? { pgBinDirectory: process.env.TEST_PG_BIN_DIRECTORY }
    : undefined;
let source: Awaited<ReturnType<typeof createIsolatedTestDatabase>> | undefined;
let admin: Client | undefined;
let directory: string | undefined;
let artifact: string;
let sourceName: string;
let sourceOid: number;
let roleCreated = false;
let operatorCreated = false;
const installationId = randomUUID();
const runtimeRole = 'gst_switch_' + randomUUID().replaceAll('-', '');
const operatorRole = 'gst_switch_operator_' + randomUUID().replaceAll('-', '');
const operatorPassword = randomBytes(32).toString('hex');
const rolePassword = randomBytes(32).toString('hex');
const candidates: string[] = [];
const previous = (name: string) =>
  name.replace('gst_recovery_', 'gst_previous_');
function runtimeUrl() {
  const url = new URL(source!.connectionString);
  url.username = runtimeRole;
  url.password = rolePassword;
  return url.toString();
}
function options(database: string) {
  return {
    connectionString: source!.connectionString,
    runtimeConnectionString: runtimeUrl(),
    recoveryDatabase: database,
    confirmActiveDatabase: sourceName,
    installationId,
    confirmWritersStopped: true,
    confirmRollbackDataLoss: true,
  };
}
async function at(database: string, fn: (db: Client) => Promise<void>) {
  const url = new URL(source!.connectionString);
  url.pathname = `/${database}`;
  const db = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.connect();
    await fn(db);
  } finally {
    await db.end();
  }
}
beforeAll(async () => {
  if (!tools) return;
  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';
  admin = new Client({
    connectionString: maintenance.toString(),
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  // Product operations use a database owner with CREATEDB, not a superuser.
  // The fixture administrator only creates/deletes roles and injects failures.
  await admin.query(
    `CREATE ROLE "${operatorRole}" LOGIN PASSWORD '${operatorPassword}' NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  operatorCreated = true;
  const operatorUrl = new URL(maintenance);
  operatorUrl.username = operatorRole;
  operatorUrl.password = operatorPassword;
  source = await createIsolatedTestDatabase(operatorUrl.toString());
  sourceName = new URL(source.connectionString).pathname.slice(1);
  sourceOid = Number(
    (
      await admin.query(
        'SELECT oid::int AS oid FROM pg_database WHERE datname=$1',
        [sourceName],
      )
    ).rows[0].oid,
  );
  await admin.query(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  roleCreated = true;
  const fixture = createDatabase(source.connectionString);
  try {
    const identity = new IdentityService(
      fixture,
      parseConfig({ NODE_ENV: 'test', DATABASE_URL: source.connectionString }),
    );
    await new OrganizationsService(identity).provisionOwner({
      organizationName: 'Backup snapshot',
      email: 'switch-owner@example.test',
      name: 'Owner',
      password: 'Recovery switch fixture password 2026!',
    });
  } finally {
    await fixture.close();
  }
  directory = await mkdtemp(join(tmpdir(), 'gst-switch-'));
  artifact = join(directory, 'fixture.gstbackup');
  await createEncryptedBackup(
    {
      connectionString: source.connectionString,
      installationId,
      key: Buffer.alloc(32, 29),
      workDirectory: join(directory, 'work'),
      ...tools,
    },
    artifact,
  );
  await at(sourceName, async (db) => {
    await db.query("UPDATE public.organizations SET name='Current original'");
    await db.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
    await db.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${runtimeRole}"`,
    );
  });
}, 120000);
async function candidate(grant = true) {
  const result = await prepareRecovery(
    {
      connectionString: source!.connectionString,
      installationId,
      key: Buffer.alloc(32, 29),
      workDirectory: join(directory!, 'work'),
      ...tools,
    },
    artifact,
    installationId,
  );
  const database = result.recoveryDatabase;
  candidates.push(database);
  if (grant)
    await provisionRecoveryRuntime({
      connectionString: source!.connectionString,
      database,
      confirmDatabase: database,
      installationId,
      runtimeRole,
    });
  return database;
}
afterEach(async () => {
  if (!admin || !source) return;
  // Failure cleanup is confined to this fixture's original OID and known names.
  const current = (
    await admin.query('SELECT datname FROM pg_database WHERE oid=$1', [
      sourceOid,
    ])
  ).rows[0]?.datname;
  if (current && current !== sourceName) {
    if (
      !/^gst_test_[a-f0-9]{32}$/.test(sourceName) ||
      !candidates.some((c) => previous(c) === current)
    )
      throw new Error('Unexpected switch fixture cleanup target');
    await admin.query(`DROP DATABASE "${sourceName}" WITH (FORCE)`);
    await admin.query(`ALTER DATABASE "${current}" RENAME TO "${sourceName}"`);
    await admin.query(`ALTER DATABASE "${sourceName}" ALLOW_CONNECTIONS true`);
  }
});
afterAll(async () => {
  try {
    for (const database of candidates) {
      if (!/^gst_recovery_[a-f0-9]{32}$/.test(database))
        throw new Error('Unexpected fixture target');
      await admin?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin?.query(
        `DROP DATABASE IF EXISTS "${previous(database)}" WITH (FORCE)`,
      );
    }
    await source?.cleanup();
    if (roleCreated) {
      if (!/^gst_switch_[a-f0-9]{32}$/.test(runtimeRole))
        throw new Error('Unexpected fixture role');
      await admin?.query(`DROP ROLE "${runtimeRole}"`);
    }
    if (operatorCreated) {
      if (!/^gst_switch_operator_[a-f0-9]{32}$/.test(operatorRole))
        throw new Error('Unexpected fixture operator');
      await admin?.query(`DROP ROLE "${operatorRole}"`);
    }
  } finally {
    await admin?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test.skipIf(!tools)(
  'activation atomically preserves the original and rollback restores it at the unchanged API address',
  async () => {
    const database = await candidate();
    const before = await recoverySwitchStatus(options(database));
    const recoveredOid = before.databases.find((d) => d.name === database)!.oid;
    expect(await switchRecovery(options(database), 'activate')).toMatchObject({
      state: 'activated',
      activeOid: recoveredOid,
      retainedOid: sourceOid,
    });
    const status = await recoverySwitchStatus(options(database));
    expect(
      status.databases.map((d) => ({ name: d.name, open: d.open, oid: d.oid })),
    ).toEqual(
      [
        { name: previous(database), open: false, oid: sourceOid },
        { name: sourceName, open: true, oid: recoveredOid },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    const runtime = createDatabase(runtimeUrl());
    try {
      await runtime.ready();
      const identity = new IdentityService(
        runtime,
        parseConfig({ NODE_ENV: 'test', DATABASE_URL: runtimeUrl() }),
      );
      const login = await identity.login(
        'switch-owner@example.test',
        'Recovery switch fixture password 2026!',
        '127.0.0.1',
      );
      const session = await identity.authenticate(login.token);
      expect(
        (await new OrganizationsService(identity).list(session))[0]?.name,
      ).toBe('Backup snapshot');
    } finally {
      await runtime.close();
    }
    await expect(
      switchRecovery(
        { ...options(database), confirmRollbackDataLoss: false },
        'rollback',
      ),
    ).rejects.toThrow();
    await expect(
      switchRecovery(
        { ...options(database), installationId: randomUUID() },
        'rollback',
      ),
    ).rejects.toThrow();
    // A matching old OID is insufficient when the runtime cannot read it.
    await admin!.query(
      `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS true`,
    );
    try {
      await at(previous(database), async (db) => {
        await db.query(
          `REVOKE SELECT ON public.organizations FROM "${runtimeRole}"`,
        );
      });
    } finally {
      await admin!.query(
        `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS false`,
      );
    }
    try {
      await expect(
        switchRecovery(options(database), 'rollback'),
      ).rejects.toThrow();
      const failed = await recoverySwitchStatus(options(database));
      expect(failed.databases.find((d) => d.name === sourceName)).toMatchObject(
        { oid: recoveredOid, open: true },
      );
      expect(
        failed.databases.find((d) => d.name === previous(database))?.open,
      ).toBe(false);
    } finally {
      await admin!.query(
        `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS true`,
      );
      try {
        await at(previous(database), async (db) => {
          await db.query(
            `GRANT SELECT ON public.organizations TO "${runtimeRole}"`,
          );
        });
      } finally {
        await admin!.query(
          `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS false`,
        );
      }
    }
    expect(await switchRecovery(options(database), 'rollback')).toMatchObject({
      state: 'rolled_back',
      activeOid: sourceOid,
      retainedOid: recoveredOid,
    });
    await at(sourceName, async (db) => {
      expect(
        (await db.query('SELECT name FROM public.organizations')).rows,
      ).toEqual([{ name: 'Current original' }]);
    });
    expect(
      (await recoverySwitchStatus(options(database))).databases.find(
        (d) => d.name === database,
      )?.open,
    ).toBe(false);
  },
  120000,
);

test.skipIf(!tools)(
  'connected writers and another operator lock prevent all switch changes',
  async () => {
    const database = await candidate();
    const before = await recoverySwitchStatus(options(database));
    await at(sourceName, async () => {
      await expect(
        switchRecovery(options(database), 'activate'),
      ).rejects.toThrow();
    });
    expect(await recoverySwitchStatus(options(database))).toEqual(before);
    const oid = before.databases.find((d) => d.name === database)!.oid;
    await admin!.query('SELECT pg_advisory_lock(73492602,$1::int)', [oid]);
    try {
      await expect(
        switchRecovery(options(database), 'activate'),
      ).rejects.toThrow();
    } finally {
      await admin!.query('SELECT pg_advisory_unlock(73492602,$1::int)', [oid]);
    }
    expect(await recoverySwitchStatus(options(database))).toEqual(before);
  },
  120000,
);

test.skipIf(!tools)(
  'missing grants, wrong identity, unsafe privileges and bad runtime credentials leave the original active',
  async () => {
    for (const scenario of [
      'missing_grants',
      'wrong_identity',
      'unsafe_privilege',
      'bad_password',
    ]) {
      const database = await candidate(scenario !== 'missing_grants');
      if (scenario === 'unsafe_privilege') {
        await admin!.query(
          `ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`,
        );
        try {
          await at(database, async (db) => {
            await db.query(
              `GRANT UPDATE(signed_grant) ON public.organization_entitlements TO "${runtimeRole}"`,
            );
          });
        } finally {
          await admin!.query(
            `ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`,
          );
        }
      }
      const value = options(database);
      if (scenario === 'wrong_identity') value.installationId = randomUUID();
      if (scenario === 'bad_password') {
        const url = new URL(value.runtimeConnectionString);
        url.password = randomUUID();
        value.runtimeConnectionString = url.toString();
      }
      await expect(switchRecovery(value, 'activate')).rejects.toThrow(
        'Recovery switch failed',
      );
      const status = await recoverySwitchStatus(options(database));
      expect(status.databases.find((d) => d.name === sourceName)).toMatchObject(
        { oid: sourceOid, open: true },
      );
      expect(status.databases.find((d) => d.name === database)?.open).toBe(
        false,
      );
      expect(status.databases.some((d) => d.name === previous(database))).toBe(
        false,
      );
    }
  },
  120000,
);

test.skipIf(!tools)(
  'a late destination collision rolls back the active connection flag transaction',
  async () => {
    const database = await candidate();
    const maintenance = new URL(adminUrl!);
    maintenance.pathname = '/postgres';
    const blocker = new Client({
      connectionString: maintenance.toString(),
      connectionTimeoutMillis: 5000,
    });
    await blocker.connect();
    let result: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT oid FROM pg_database WHERE oid=$1 FOR UPDATE',
        [sourceOid],
      );
      result = switchRecovery(options(database), 'activate').then(
        () => 'unexpected_success',
        () => 'rejected',
      );
      let blocked = false;
      for (let attempt = 0; attempt < 75; attempt++) {
        blocked = (
          await admin!.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query=$1) AS blocked",
            [`ALTER DATABASE "${sourceName}" ALLOW_CONNECTIONS false`],
          )
        ).rows[0].blocked;
        if (blocked) break;
        await new Promise((done) => setTimeout(done, 100));
      }
      expect(blocked).toBe(true);
      await admin!.query(`CREATE DATABASE "${previous(database)}"`);
      await blocker.query('COMMIT');
      expect(await result).toBe('rejected');
      const status = await recoverySwitchStatus(options(database));
      expect(status.databases.find((d) => d.name === sourceName)).toMatchObject(
        { oid: sourceOid, open: true },
      );
      expect(status.databases.find((d) => d.name === database)?.open).toBe(
        false,
      );
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await result;
      await admin!.query(
        `DROP DATABASE IF EXISTS "${previous(database)}" WITH (FORCE)`,
      );
    }
  },
  120000,
);

test.skipIf(!tools)(
  'compiled CLI activates, inspects and reverses only the confirmed fixture without leaking credentials',
  async () => {
    const database = await candidate();
    const run = async (action: string) =>
      promisify(execFile)(
        process.execPath,
        [
          resolve('packages/database/dist/recovery-switch-cli.js'),
          action,
          '--recovery-database',
          database,
          '--confirm-active-database',
          sourceName,
          '--installation-id',
          installationId,
          ...(action === 'status' ? [] : ['--confirm-writers-stopped']),
          ...(action === 'rollback' ? ['--confirm-rollback-data-loss'] : []),
        ],
        {
          env: {
            ...process.env,
            MIGRATION_DATABASE_URL: source!.connectionString,
            DATABASE_URL: runtimeUrl(),
          },
          timeout: 110000,
          windowsHide: true,
        },
      );
    for (const action of ['activate', 'status', 'rollback']) {
      const { stdout, stderr } = await run(action);
      expect(JSON.parse(stdout).event).toBe('recovery_switch_' + action);
      expect(stdout).not.toContain(rolePassword);
      expect(stdout).not.toContain(operatorPassword);
      expect(stdout).not.toContain(source!.connectionString);
      expect(stderr).toBe('');
    }
  },
  120000,
);

test.skipIf(!tools)(
  'forward migration switches only the copy and rollback restores the verified original schema without a down migration',
  async () => {
    // Keep this historical-schema fixture last. Its original is deliberately
    // left on Phase 5 for deletion by the fixture cleanup, never re-migrated to
    // manufacture current-release compatibility for another test.
    const oldDigest = await migrationDigest(5);
    const targetDigest = await migrationDigest();
    const historicalFixture = createDatabase(source!.connectionString);
    try {
      await setTestDatabaseToPhase5(historicalFixture);
    } finally {
      await historicalFixture.close();
    }
    const backup = {
      connectionString: source!.connectionString,
      installationId,
      key: Buffer.alloc(32, 29),
      workDirectory: join(directory!, 'work'),
      ...tools!,
    };
    const oldArtifact = join(directory!, 'older-release.gstbackup');
    expect(
      (await createEncryptedBackup(backup, oldArtifact)).schemaDigest,
    ).toBe(oldDigest);
    const prepared = await prepareRecovery(
      backup,
      oldArtifact,
      installationId,
      targetDigest,
    );
    const database = prepared.recoveryDatabase;
    candidates.push(database);
    expect(prepared).toMatchObject({
      upgraded: true,
      schemaDigest: targetDigest,
    });
    await provisionRecoveryRuntime({
      connectionString: source!.connectionString,
      database,
      confirmDatabase: database,
      installationId,
      runtimeRole,
    });
    await expect(
      switchRecovery(
        { ...options(database), originalSchemaDigest: targetDigest },
        'activate',
      ),
    ).rejects.toThrow();
    const bound = { ...options(database), originalSchemaDigest: oldDigest };
    await expect(switchRecovery(bound, 'activate')).resolves.toMatchObject({
      state: 'activated',
      retainedOid: sourceOid,
    });
    let history: { id: number; hash: string } | undefined;
    await admin!.query(
      `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS true`,
    );
    try {
      await at(previous(database), async (db) => {
        expect(
          (
            await db.query(
              "SELECT to_regclass('public.organization_entitlements') AS relation",
            )
          ).rows[0].relation,
        ).toBeNull();
        expect(
          (
            await db.query(
              'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
            )
          ).rows[0].count,
        ).toBe(5);
        history = (
          await db.query(
            'SELECT id,hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1',
          )
        ).rows[0];
        await db.query(
          'UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2',
          ['0'.repeat(64), history!.id],
        );
      });
    } finally {
      await admin!.query(
        `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS false`,
      );
    }
    await expect(switchRecovery(bound, 'rollback')).rejects.toThrow();
    const rejected = await recoverySwitchStatus(bound);
    expect(
      rejected.databases.find((d) => d.name === previous(database)),
    ).toMatchObject({ oid: sourceOid, open: false });
    expect(rejected.databases.find((d) => d.name === sourceName)?.oid).not.toBe(
      sourceOid,
    );
    await admin!.query(
      `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS true`,
    );
    try {
      await at(previous(database), async (db) => {
        await db.query(
          'UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2',
          [history!.hash, history!.id],
        );
      });
    } finally {
      await admin!.query(
        `ALTER DATABASE "${previous(database)}" ALLOW_CONNECTIONS false`,
      );
    }
    await expect(
      switchRecovery(
        { ...bound, originalSchemaDigest: targetDigest },
        'rollback',
      ),
    ).rejects.toThrow();
    await expect(switchRecovery(bound, 'rollback')).resolves.toMatchObject({
      state: 'rolled_back',
      activeOid: sourceOid,
    });
    await expect(
      assertRecoveryRuntimeReady(runtimeUrl(), oldDigest),
    ).resolves.toBeUndefined();
    const currentApi = createDatabase(runtimeUrl());
    try {
      // Retained-release recovery never relaxes current application startup.
      await expect(currentApi.ready()).rejects.toThrow();
    } finally {
      await currentApi.close();
    }
    await at(sourceName, async (db) => {
      expect(
        (
          await db.query(
            'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
          )
        ).rows[0].count,
      ).toBe(5);
      expect(
        (await db.query('SELECT name FROM public.organizations')).rows,
      ).toEqual([{ name: 'Current original' }]);
    });
  },
  120000,
);
