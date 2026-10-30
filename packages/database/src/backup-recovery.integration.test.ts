import { afterAll, beforeAll, expect, test } from 'vitest';
import { Client } from 'pg';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createIsolatedTestDatabase } from './testing.js';
import { auditEvents, organizations, sessions, users } from './index.js';
import {
  createEncryptedBackup,
  migrationDigest,
  prepareRecovery,
} from './backup-operator.js';
import { decryptBackup, encryptBackup } from './backup-artifact.js';
import type { BackupOperatorOptions } from './backup-operator.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for isolated recovery tests',
  );
const tools = process.env.TEST_BACKUP_DOCKER_CONTAINER
  ? { dockerContainer: process.env.TEST_BACKUP_DOCKER_CONTAINER }
  : process.env.TEST_PG_BIN_DIRECTORY
    ? { pgBinDirectory: process.env.TEST_PG_BIN_DIRECTORY }
    : undefined;
let source: Awaited<ReturnType<typeof createIsolatedTestDatabase>> | undefined;
let admin: Client | undefined;
let directory: string | undefined;
let options: BackupOperatorOptions;
let artifact: string;
const retained: string[] = [];
beforeAll(async () => {
  if (!tools) return;
  source = await createIsolatedTestDatabase(adminUrl);
  admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  directory = await mkdtemp(join(tmpdir(), 'gst-recovery-test-'));
  await source.database.db
    .insert(organizations)
    .values({ name: 'Preserved recovery business', status: 'suspended' });
  const [user] = await source.database.db
    .insert(users)
    .values({
      edition: 'offline',
      email: 'fixture@example.test',
      name: 'Recovery fixture',
      passwordHash: 'fixture-only-never-authenticated',
    })
    .returning();
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
  artifact = join(directory, 'recovery.gstbackup');
  await createEncryptedBackup(options, artifact);
}, 120000);
afterAll(async () => {
  try {
    for (const name of retained) {
      if (!/^gst_recovery_[a-f0-9]{32}$/.test(name))
        throw new Error('Unexpected recovery cleanup target');
      await admin?.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  } finally {
    await admin?.end();
    await source?.cleanup();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function inspectCandidate(name: string) {
  expect(name).toMatch(/^gst_recovery_[a-f0-9]{32}$/);
  const flags = await admin!.query(
    `SELECT datallowconn, EXISTS (SELECT 1 FROM aclexplode(coalesce(datacl, acldefault('d', datdba))) WHERE grantee = 0 AND privilege_type IN ('CONNECT','TEMPORARY')) AS public_access FROM pg_database WHERE datname = $1`,
    [name],
  );
  expect(flags.rows).toEqual([{ datallowconn: false, public_access: false }]);
  const url = new URL(source!.connectionString);
  url.pathname = `/${name}`;
  const blocked = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await expect(blocked.connect()).rejects.toMatchObject({ code: '55000' });
  } finally {
    await blocked.end();
  }
  // Operator-only inspection of this generated candidate; never a live cutover.
  await admin!.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
  const restored = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await restored.connect();
    expect(
      (await restored.query('SELECT name FROM organizations')).rows,
    ).toEqual([{ name: 'Preserved recovery business' }]);
    expect(
      (await restored.query('SELECT password_hash FROM users')).rows,
    ).toEqual([{ password_hash: 'fixture-only-never-authenticated' }]);
    expect(
      (await restored.query('SELECT count(*)::int AS count FROM sessions'))
        .rows,
    ).toEqual([{ count: 0 }]);
    const audit = await restored.query(
      'SELECT action, metadata FROM audit_events ORDER BY created_at',
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'fixture.original',
      'recovery.prepared',
    ]);
    expect(audit.rows[1].metadata.sessionsInvalidated).toBe('1');
  } finally {
    await restored.end();
    await admin!.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`);
  }
}

test.skipIf(!tools)(
  'recovery retains only a quarantined database, invalidates copied sessions and preserves the source',
  async () => {
    const before = await source!.database.db.select().from(sessions);
    const result = await prepareRecovery(
      options,
      artifact,
      options.installationId,
    );
    retained.push(result.recoveryDatabase);
    expect(result).toMatchObject({
      state: 'quarantined',
      installationId: options.installationId,
      sessionsInvalidated: 1,
    });
    await inspectCandidate(result.recoveryDatabase);
    expect(await source!.database.db.select().from(sessions)).toEqual(before);
    expect(
      (await source!.database.db.select().from(auditEvents)).map(
        (row) => row.action,
      ),
    ).toEqual(['fixture.original']);
    expect(await readdir(options.workDirectory)).toEqual([]);
  },
  120000,
);

test.skipIf(!tools)(
  'the compiled operator CLI prepares a separate candidate without exposing credentials',
  async () => {
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
    expect(response.event).toBe('recovery_prepared');
    expect(stderr).toBe('');
    expect(stdout).not.toContain(source!.connectionString);
    expect(stdout).not.toContain(options.key.toString('hex'));
    await inspectCandidate(response.result.recoveryDatabase);
  },
  120000,
);

test.skipIf(!tools)(
  'wrong keys, installation identities and corrupted archives retain no candidate database',
  async () => {
    const before = (
      await admin!.query(
        "SELECT datname FROM pg_database WHERE datname LIKE 'gst_recovery_%' ORDER BY datname",
      )
    ).rows;
    await expect(
      prepareRecovery(
        { ...options, key: randomBytes(32) },
        artifact,
        options.installationId,
      ),
    ).rejects.toThrow();
    const otherId = randomUUID();
    await expect(
      prepareRecovery(
        { ...options, installationId: otherId },
        artifact,
        otherId,
      ),
    ).rejects.toThrow();
    const damaged = join(directory!, 'damaged.gstbackup');
    const bytes = await readFile(artifact);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await writeFile(damaged, bytes);
    await expect(
      prepareRecovery(options, damaged, options.installationId),
    ).rejects.toThrow();
    // Force a failure after creating/restoring the database, not just preflight.
    const dump = join(directory!, 'fixture-count-mismatch.dump');
    const metadata = await decryptBackup(artifact, dump, options.key, {
      installationId: options.installationId,
      schemaDigest: await migrationDigest(),
    });
    const mismatched = join(directory!, 'fixture-count-mismatch.gstbackup');
    await encryptBackup(dump, mismatched, options.key, {
      installationId: options.installationId,
      schemaDigest: metadata.schemaDigest,
      rowCounts: { ...metadata.rowCounts, 'public.organizations': 999 },
    });
    await expect(
      prepareRecovery(options, mismatched, options.installationId),
    ).rejects.toThrow('table counts');
    expect(
      (
        await admin!.query(
          "SELECT datname FROM pg_database WHERE datname LIKE 'gst_recovery_%' ORDER BY datname",
        )
      ).rows,
    ).toEqual(before);
    expect(await readdir(options.workDirectory)).toEqual([]);
  },
  120000,
);
