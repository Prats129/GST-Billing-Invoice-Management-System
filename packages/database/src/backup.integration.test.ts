import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedTestDatabase } from './testing.js';
import { organizations, sql } from './index.js';
import {
  createEncryptedBackup,
  prepareRecovery,
  verifyRestore,
} from './backup-operator.js';
import type { BackupOperatorOptions } from './backup-operator.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for disposable backup databases',
  );
const dockerContainer = process.env.TEST_BACKUP_DOCKER_CONTAINER;
const pgBinDirectory = process.env.TEST_PG_BIN_DIRECTORY;
const enabled = Boolean(dockerContainer || pgBinDirectory);
let isolated:
  Awaited<ReturnType<typeof createIsolatedTestDatabase>> | undefined;
let directory: string | undefined;
beforeAll(async () => {
  if (!enabled) return;
  isolated = await createIsolatedTestDatabase(adminUrl);
  directory = await mkdtemp(join(tmpdir(), 'gst-backup-integration-'));
  await isolated.database.db
    .insert(organizations)
    .values({ name: 'Backup preservation fixture', status: 'suspended' });
});
afterAll(async () => {
  await isolated?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test.skipIf(!enabled)(
  'encrypted PostgreSQL dump restores into a new database with matching counts and leaves the source unchanged',
  async () => {
    const options: BackupOperatorOptions = {
      connectionString: isolated!.connectionString,
      installationId: randomUUID(),
      key: randomBytes(32),
      workDirectory: join(directory!, 'work'),
      ...(dockerContainer ? { dockerContainer } : {}),
      ...(pgBinDirectory ? { pgBinDirectory } : {}),
    };
    const artifact = join(directory!, 'fixture.gstbackup');
    const manifest = await createEncryptedBackup(options, artifact);
    expect(manifest.rowCounts['public.organizations']).toBe(1);
    expect(
      (await readFile(artifact)).includes(
        Buffer.from('Backup preservation fixture'),
      ),
    ).toBe(false);
    const verified = await verifyRestore(options, artifact);
    expect(verified.verified).toBe(true);
    expect(verified.currentReleaseCompatible).toBe(true);
    expect(verified.schemaDigest).toBe(manifest.schemaDigest);
    expect(verified.tables).toBe(Object.keys(manifest.rowCounts).length);
    expect(
      await isolated!.database.db.select().from(organizations),
    ).toHaveLength(1);
    await expect(
      verifyRestore({ ...options, key: randomBytes(32) }, artifact),
    ).rejects.toThrow();
    expect(await readdir(options.workDirectory)).toEqual([]);
    const names = await isolated!.database.db.execute(
      sql`select datname from pg_database where datname=${verified.verificationDatabase}`,
    );
    expect(names.rows).toEqual([]);
  },
  120000,
);

test.skipIf(!enabled)(
  'a pre-upgrade Phase 5 backup verifies without claiming current-release readiness',
  async () => {
    // This downgrade is confined to this randomly created test fixture. The
    // operator CLI never rolls back a live schema or deletes migration history.
    await isolated!.database.db.execute(
      sql`drop table organization_entitlements`,
    );
    await isolated!.database.db.execute(
      sql`delete from drizzle.__drizzle_migrations where id=(select max(id) from drizzle.__drizzle_migrations)`,
    );
    const options: BackupOperatorOptions = {
      connectionString: isolated!.connectionString,
      installationId: randomUUID(),
      key: randomBytes(32),
      workDirectory: join(directory!, 'work'),
      ...(dockerContainer ? { dockerContainer } : {}),
      ...(pgBinDirectory ? { pgBinDirectory } : {}),
    };
    const path = join(directory!, 'pre-upgrade.gstbackup');
    await createEncryptedBackup(options, path);
    const result = await verifyRestore(options, path);
    expect(result.verified).toBe(true);
    expect(result.currentReleaseCompatible).toBe(false);
    await expect(
      prepareRecovery(options, path, options.installationId),
    ).rejects.toThrow('exact schema');
    expect(await readdir(options.workDirectory)).toEqual([]);
  },
  120000,
);
