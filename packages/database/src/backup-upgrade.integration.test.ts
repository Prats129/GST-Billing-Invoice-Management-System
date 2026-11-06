import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client } from 'pg';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createIsolatedTestDatabase,
  setTestDatabaseToPhase5,
} from './testing.js';
import { auditEvents, organizations, sessions, sql } from './index.js';
import {
  createEncryptedBackup,
  migrationDigest,
  prepareRecovery,
} from './backup-operator.js';
import type { BackupOperatorOptions } from './backup-operator.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for isolated upgrade tests',
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
let options: BackupOperatorOptions;
let targetDigest: string;
let backupDigest: string;
const retained: string[] = [];
beforeAll(async () => {
  if (!tools) return;
  source = await createIsolatedTestDatabase(adminUrl);
  admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  directory = await mkdtemp(join(tmpdir(), 'gst-upgrade-test-'));
  // Simulate the old release only in this randomly created test database.
  await setTestDatabaseToPhase5(source.database);
  await source.database.db
    .insert(organizations)
    .values({ name: 'Older release business', status: 'suspended' });
  const inserted = await source.database.db.execute(
    sql`INSERT INTO users(id,edition,email,name,password_hash) VALUES(gen_random_uuid(),'offline','upgrade@example.test','Upgrade fixture','fixture-only-not-a-login') RETURNING id`,
  );
  const user = { id: String(inserted.rows[0]!.id) };
  await source.database.db.insert(sessions).values({
    userId: user!.id,
    edition: 'offline',
    tokenHash: 'ab'.repeat(32),
    csrfHash: 'cd'.repeat(32),
    expiresAt: new Date(Date.now() + 3600000),
  });
  await source.database.db
    .insert(auditEvents)
    .values({ action: 'fixture.original' });
  options = {
    connectionString: source.connectionString,
    installationId: randomUUID(),
    key: randomBytes(32),
    workDirectory: join(directory, 'work'),
    ...tools,
  };
  artifact = join(directory, 'phase5.gstbackup');
  const manifest = await createEncryptedBackup(options, artifact);
  backupDigest = manifest.schemaDigest;
  targetDigest = await migrationDigest();
  expect(backupDigest).not.toBe(targetDigest);
}, 120000);
afterAll(async () => {
  try {
    for (const name of retained) {
      if (!/^gst_recovery_[a-f0-9]{32}$/.test(name))
        throw new Error('Unexpected generated upgrade target');
      await admin?.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  } finally {
    await admin?.end();
    await source?.cleanup();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function sourceState() {
  return {
    organizations: await source!.database.db.select().from(organizations),
    users: (await source!.database.db.execute(sql`SELECT * FROM users`)).rows,
    sessions: await source!.database.db.select().from(sessions),
    audit: await source!.database.db.select().from(auditEvents),
    history: (
      await source!.database.db.execute(
        sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`,
      )
    ).rows,
    entitlementTable: (
      await source!.database.db.execute(
        sql`SELECT to_regclass('public.organization_entitlements') AS name`,
      )
    ).rows,
  };
}
async function recoveryNames() {
  return (
    await admin!.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'gst_recovery_%' ORDER BY datname",
    )
  ).rows;
}
test.skipIf(!tools)(
  'an old backup is rejected without explicit upgrade confirmation',
  async () => {
    const before = await recoveryNames();
    await expect(
      prepareRecovery(options, artifact, options.installationId),
    ).rejects.toThrow('exact schema');
    await expect(
      prepareRecovery(
        options,
        artifact,
        options.installationId,
        'ab'.repeat(32),
      ),
    ).rejects.toThrow('exact current release schema digest');
    expect(await recoveryNames()).toEqual(before);
    expect(await readdir(options.workDirectory)).toEqual([]);
  },
  120000,
);

test.skipIf(!tools)(
  'explicit forward migration upgrades only the recovery copy and leaves the old source and archive intact',
  async () => {
    const before = await sourceState();
    const bytes = await readFile(artifact);
    const result = await prepareRecovery(
      options,
      artifact,
      options.installationId,
      targetDigest,
    );
    retained.push(result.recoveryDatabase);
    expect(result).toMatchObject({
      upgraded: true,
      backupSchemaDigest: backupDigest,
      schemaDigest: targetDigest,
      state: 'quarantined',
      sessionsInvalidated: 1,
    });
    const flags = await admin!.query(
      'SELECT datallowconn FROM pg_database WHERE datname = $1',
      [result.recoveryDatabase],
    );
    expect(flags.rows).toEqual([{ datallowconn: false }]);
    const url = new URL(source!.connectionString);
    url.pathname = `/${result.recoveryDatabase}`;
    await admin!.query(
      `ALTER DATABASE "${result.recoveryDatabase}" ALLOW_CONNECTIONS true`,
    );
    const candidate = new Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5000,
    });
    try {
      await candidate.connect();
      expect(
        (
          await candidate.query(
            "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname IN ('public','drizzle')",
          )
        ).rows,
      ).toEqual([{ count: result.tables }]);
      expect(
        (
          await candidate.query(
            "SELECT to_regclass('public.organization_entitlements')::text AS name",
          )
        ).rows,
      ).toEqual([{ name: 'organization_entitlements' }]);
      expect(
        (await candidate.query('SELECT count(*)::int AS count FROM sessions'))
          .rows,
      ).toEqual([{ count: 0 }]);
      expect(
        (await candidate.query('SELECT name FROM organizations')).rows,
      ).toEqual([{ name: 'Older release business' }]);
      const audit = (
        await candidate.query(
          "SELECT metadata FROM audit_events WHERE action = 'recovery.prepared'",
        )
      ).rows[0].metadata;
      expect(audit).toMatchObject({
        backupSchemaDigest: backupDigest,
        schemaDigest: targetDigest,
      });
    } finally {
      await candidate.end();
      await admin!.query(
        `ALTER DATABASE "${result.recoveryDatabase}" ALLOW_CONNECTIONS false`,
      );
    }
    expect(await sourceState()).toEqual(before);
    expect(await readFile(artifact)).toEqual(bytes);
    expect(await readdir(options.workDirectory)).toEqual([]);
  },
  120000,
);

test.skipIf(!tools)(
  'the compiled CLI accepts an explicit target without migrating the source',
  async () => {
    const before = await sourceState();
    const keyFile = join(directory!, 'ephemeral.key');
    await writeFile(keyFile, options.key, { mode: 0o600 });
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        resolve('packages/database/dist/backup-cli.js'),
        'prepare-recovery',
        '--key-file',
        keyFile,
        '--installation-id',
        options.installationId,
        '--confirm-installation-id',
        options.installationId,
        '--upgrade-to-schema',
        targetDigest,
        '--work-directory',
        options.workDirectory,
        '--artifact',
        artifact,
        ...(options.dockerContainer
          ? ['--docker-container', options.dockerContainer]
          : ['--pg-bin-directory', options.pgBinDirectory!]),
      ],
      {
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: source!.connectionString,
        },
        timeout: 110000,
      },
    );
    const response = JSON.parse(stdout);
    retained.push(response.result.recoveryDatabase);
    expect(response).toMatchObject({
      event: 'recovery_prepared',
      result: {
        upgraded: true,
        schemaDigest: targetDigest,
        backupSchemaDigest: backupDigest,
      },
    });
    expect(stderr).toBe('');
    expect(stdout).not.toContain(source!.connectionString);
    expect(await sourceState()).toEqual(before);
  },
  120000,
);

test.skipIf(!tools)(
  'a failing forward migration drops only its generated candidate and preserves the old source',
  async () => {
    // An intentional collision inside this test fixture makes migration 0005 fail
    // after restore. No repository SQL, real source or permission policy is edited.
    await source!.database.db.execute(
      sql`CREATE VIEW organization_entitlements AS SELECT 1 AS fixture_only`,
    );
    try {
      const broken = join(directory!, 'migration-collision.gstbackup');
      await createEncryptedBackup(options, broken);
      const before = await sourceState();
      const names = await recoveryNames();
      await expect(
        prepareRecovery(options, broken, options.installationId, targetDigest),
      ).rejects.toThrow('Recovery migration failed');
      expect(await recoveryNames()).toEqual(names);
      expect(await sourceState()).toEqual(before);
      expect(await readdir(options.workDirectory)).toEqual([]);
    } finally {
      await source!.database.db.execute(
        sql`DROP VIEW organization_entitlements`,
      );
    }
  },
  120000,
);
