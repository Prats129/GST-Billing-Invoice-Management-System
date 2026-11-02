import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDatabase, eq, organizations } from '@gst/database';
import { createIsolatedTestDatabase } from '@gst/database/testing';
import { createEncryptedBackup, prepareRecovery } from './backup-operator.js';
import { provisionRecoveryRuntime } from './runtime-access.js';
import { parseConfig } from '../../../apps/api/src/config.js';
import { IdentityService } from '../../../apps/api/src/security/identity.service.js';
import { OrganizationsService } from '../../../apps/api/src/security/organizations.service.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for isolated runtime-access tests',
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
let ownerId: string;
const installationId = randomUUID();
const runtimeRole = 'gst_runtime_' + randomUUID().replaceAll('-', '');
const groupRole = 'gst_group_' + randomUUID().replaceAll('-', '');
const rolePassword = randomBytes(32).toString('hex');
const ownerPassword = 'Runtime access fixture password 2026!';
const candidates: string[] = [];
const roles: string[] = [];
beforeAll(async () => {
  if (!tools) return;
  source = await createIsolatedTestDatabase(adminUrl);
  const config = parseConfig({
    NODE_ENV: 'test',
    DATABASE_URL: source.connectionString,
  });
  const identity = new IdentityService(source.database, config);
  const result = await new OrganizationsService(identity).provisionOwner({
    organizationName: 'Runtime permissions fixture',
    email: 'runtime-owner@example.test',
    name: 'Owner',
    password: ownerPassword,
  });
  ownerId = result.organizationId;
  admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  // Ephemeral test roles only. Production tooling never creates accounts or
  // reads/sets their passwords; that remains a protected operator procedure.
  await admin.query(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  roles.push(runtimeRole);
  await admin.query(`CREATE ROLE "${groupRole}" NOLOGIN`);
  roles.push(groupRole);
  directory = await mkdtemp(join(tmpdir(), 'gst-runtime-access-'));
  artifact = join(directory, 'fixture.gstbackup');
  await createEncryptedBackup(
    {
      connectionString: source.connectionString,
      installationId,
      key: Buffer.alloc(32, 17),
      workDirectory: join(directory, 'work'),
      ...tools,
    },
    artifact,
  );
}, 120000);
afterAll(async () => {
  try {
    for (const name of candidates) {
      if (!/^gst_recovery_[a-f0-9]{32}$/.test(name))
        throw new Error('Unexpected fixture cleanup target');
      await admin?.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    for (const role of roles) {
      if (!/^gst_(runtime|group)_[a-f0-9]{32}$/.test(role))
        throw new Error('Unexpected fixture role');
      await admin?.query(`DROP ROLE "${role}"`);
    }
  } finally {
    await admin?.end();
    await source?.cleanup();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
async function candidate() {
  const result = await prepareRecovery(
    {
      connectionString: source!.connectionString,
      installationId,
      key: Buffer.alloc(32, 17),
      workDirectory: join(directory!, 'work'),
      ...tools,
    },
    artifact,
    installationId,
  );
  candidates.push(result.recoveryDatabase);
  return result.recoveryDatabase;
}
function options(database: string) {
  return {
    connectionString: source!.connectionString,
    database,
    confirmDatabase: database,
    installationId,
    runtimeRole,
  };
}
async function flags(database: string) {
  return (
    await admin!.query(
      'SELECT datallowconn FROM pg_database WHERE datname=$1',
      [database],
    )
  ).rows;
}
async function inspect(
  database: string,
  action: (client: Client) => Promise<void>,
) {
  const url = new URL(source!.connectionString);
  url.pathname = `/${database}`;
  await admin!.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`);
  const db = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.connect();
    await action(db);
  } finally {
    await db.end();
    await admin!.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`);
  }
}
test.skipIf(!tools)(
  'a real runtime account can log in and use authorized API services but cannot perform protected database operations',
  async () => {
    const database = await candidate();
    expect(await provisionRecoveryRuntime(options(database))).toMatchObject({
      state: 'quarantined',
      database,
      runtimeRole,
    });
    expect(await flags(database)).toEqual([{ datallowconn: false }]);
    // Repeating on an unused candidate safely removes/restores only its CONNECT.
    await expect(
      provisionRecoveryRuntime(options(database)),
    ).resolves.toMatchObject({
      state: 'quarantined',
    });
    const url = new URL(source!.connectionString);
    url.pathname = `/${database}`;
    url.username = runtimeRole;
    url.password = rolePassword;
    await admin!.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`);
    const runtime = createDatabase(url.toString());
    const raw = new Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5000,
    });
    try {
      await runtime.ready();
      await raw.connect();
      const config = parseConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
      });
      const identity = new IdentityService(runtime, config);
      const login = await identity.login(
        'runtime-owner@example.test',
        ownerPassword,
        '127.0.0.1',
      );
      const session = await identity.authenticate(login.token);
      const orgs = new OrganizationsService(identity);
      expect((await orgs.list(session)).map((row) => row.id)).toContain(
        ownerId,
      );
      await orgs.write(session, ownerId, 'organization.manage', async (tx) => {
        await tx
          .update(organizations)
          .set({ name: 'Changed only in recovery copy' })
          .where(eq(organizations.id, ownerId));
      });
      for (const query of [
        'CREATE TABLE public.forbidden_fixture(id int)',
        'ALTER TABLE public.users DISABLE TRIGGER ALL',
        "UPDATE public.audit_events SET action='tampered'",
        'DELETE FROM public.audit_events',
        'TRUNCATE public.audit_events',
        'SELECT token_hash FROM public.owner_recovery',
        'SELECT * FROM drizzle.__drizzle_migrations',
        "UPDATE public.organization_entitlements SET signed_grant='{}'::jsonb",
        'DELETE FROM public.invoice_snapshots',
      ])
        await expect(raw.query(query)).rejects.toMatchObject({ code: '42501' });
      await raw.query(
        'UPDATE public.organization_entitlements SET last_observed_at=now()',
      );
      expect(
        (
          await raw.query(
            "SELECT has_table_privilege(current_user,'public.audit_events','SELECT WITH GRANT OPTION') AS delegable",
          )
        ).rows,
      ).toEqual([{ delegable: false }]);
    } finally {
      await raw.end();
      await runtime.close();
      await admin!.query(
        `ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`,
      );
    }
    expect(
      (await source!.database.db.select().from(organizations))[0]?.name,
    ).toBe('Runtime permissions fixture');
    // Runtime login created a session: this candidate is no longer unused.
    await expect(provisionRecoveryRuntime(options(database))).rejects.toThrow();
    expect(await flags(database)).toEqual([{ datallowconn: false }]);
  },
  120000,
);

test.skipIf(!tools)(
  'wrong identity, open candidates, privileged accounts and memberships are rejected',
  async () => {
    const database = await candidate();
    await expect(
      provisionRecoveryRuntime({
        ...options(database),
        installationId: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(await flags(database)).toEqual([{ datallowconn: false }]);
    await inspect(database, async (db) => {
      await expect(
        provisionRecoveryRuntime(options(database)),
      ).rejects.toThrow();
      expect(
        (
          await db.query(
            "SELECT has_table_privilege($1,'public.users','SELECT') AS granted",
            [runtimeRole],
          )
        ).rows,
      ).toEqual([{ granted: false }]);
    });
    const operator = (await admin!.query('SELECT current_user AS name')).rows[0]
      .name;
    await expect(
      provisionRecoveryRuntime({ ...options(database), runtimeRole: operator }),
    ).rejects.toThrow();
    await admin!.query(
      `GRANT "${groupRole}" TO "${runtimeRole}" WITH INHERIT FALSE, SET FALSE`,
    );
    try {
      await expect(
        provisionRecoveryRuntime(options(database)),
      ).rejects.toThrow();
    } finally {
      await admin!.query(`REVOKE "${groupRole}" FROM "${runtimeRole}"`);
    }
    expect(await flags(database)).toEqual([{ datallowconn: false }]);
  },
  120000,
);

test.skipIf(!tools)(
  'unexpected column or PUBLIC access fails closed and no partial policy is committed',
  async () => {
    for (const poison of [
      `GRANT UPDATE (signed_grant) ON public.organization_entitlements TO "${runtimeRole}"`,
      'GRANT SELECT ON public.owner_recovery TO PUBLIC',
      `GRANT USAGE ON SCHEMA public TO "${runtimeRole}" WITH GRANT OPTION`,
    ]) {
      const database = await candidate();
      await inspect(database, async (db) => {
        await db.query(poison);
      });
      await expect(
        provisionRecoveryRuntime(options(database)),
      ).rejects.toThrow();
      expect(await flags(database)).toEqual([{ datallowconn: false }]);
      await inspect(database, async (db) => {
        expect(
          (
            await db.query(
              "SELECT has_table_privilege($1,'public.users','SELECT') AS granted",
              [runtimeRole],
            )
          ).rows,
        ).toEqual([{ granted: false }]);
      });
    }
  },
  120000,
);

test.skipIf(!tools)(
  'the compiled host CLI provisions a fresh candidate without exposing database or role credentials',
  async () => {
    const database = await candidate();
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        resolve('packages/database/dist/runtime-access-cli.js'),
        '--database',
        database,
        '--confirm-database',
        database,
        '--installation-id',
        installationId,
        '--role',
        runtimeRole,
      ],
      {
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: source!.connectionString,
        },
        timeout: 110000,
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      event: 'recovery_runtime_access_provisioned',
      state: 'quarantined',
      database,
      runtimeRole,
    });
    expect(stderr).toBe('');
    expect(stdout).not.toContain(rolePassword);
    expect(stdout).not.toContain(source!.connectionString);
    expect(await flags(database)).toEqual([{ datallowconn: false }]);
  },
  120000,
);
