import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  writeFile,
  rm,
  readFile,
  appendFile,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, resolve, sep } from 'node:path';
import { Client, store, migratePlatform } from './store.js';
import { createIsolatedTestDatabase } from '../../../packages/database/src/testing.js';
import { sql } from '../../../packages/database/src/index.js';
import { verifyRestore } from '../../../packages/database/src/backup-operator.js';
import { secureDirectory } from '../../api/src/operations/release-staging.js';
import { saveNewFile } from '../../../scripts/setup/workflow.js';
import {
  backupProfile,
  databaseIdentity,
  saveBackupProfile,
} from '../../../scripts/operations/profiles.js';
import type { BackupProfile } from '../../../scripts/operations/profiles.js';
import {
  runBackupJob,
  backupStatus,
  inspectJobs,
  withTarget,
  acknowledgeInterruptedJob,
  publishBackupStatus,
} from '../../../scripts/operations/runner.js';
import {
  reconcilePlatformRecovery,
  recoveryInventory,
  billingRecoveryAction,
} from '../../../scripts/operations/recovery.js';
import { readBackupStatus } from './backup-status.js';

const authority = process.env.TEST_DATABASE_ADMIN_URL,
  container = process.env.TEST_BACKUP_DOCKER_CONTAINER;
describe.skipIf(!authority || !container)(
  'protected backup profiles and real platform/customer recovery engines',
  () => {
    let root: Client,
      platform: ReturnType<typeof store>,
      billing: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
    let parent: string,
      directory: string,
      name: string,
      profile: BackupProfile,
      artifact: string,
      recoveryJob: string,
      candidate: string,
      billingCandidate: string;
    const parentRoot =
      process.platform === 'win32'
        ? (process.env.LOCALAPPDATA ?? tmpdir())
        : tmpdir();
    beforeAll(async () => {
      root = new Client({ connectionString: authority });
      await root.connect();
      name = 'gst_platform_backup_' + randomUUID().replaceAll('-', '');
      await root.query(`CREATE DATABASE "${name}"`);
      const url = new URL(authority!);
      url.pathname = '/' + name;
      platform = store(url.toString());
      await migratePlatform(platform);
      billing = await createIsolatedTestDatabase(authority!);
      const owner = randomUUID(),
        org = randomUUID();
      await platform.query(
        "INSERT INTO platform_owner(id,email,name,password_hash,recovery_hash) VALUES($1,'backup@example.test','Backup owner','test-hash','test-recovery')",
        [owner],
      );
      await platform.query(
        "INSERT INTO platform_sessions(token_hash,owner_id,csrf_hash,expires_at) VALUES('copied-session',$1,'csrf',now()+interval '1 hour')",
        [owner],
      );
      await platform.query(
        "INSERT INTO platform_organizations(id,runtime_id,edition,installation_id,name,email,state) VALUES($1,$2,'offline',$3,'Backup customer','backup@example.test','registered')",
        [org, randomUUID(), randomUUID()],
      );
      await platform.query(
        "INSERT INTO platform_audit(action,organization_id) VALUES('backup.fixture',$1)",
        [org],
      );
      await platform.query(
        'UPDATE platform_control SET operations_enabled=true',
      );
      parent = await mkdtemp(join(parentRoot, 'gst-backup-guided-'));
      await secureDirectory(parent);
      directory = join(parent, 'profile');
      const envFile = join(parent, 'operator.env');
      await writeFile(
        envFile,
        'MIGRATION_DATABASE_URL=' +
          billing.connectionString +
          '\nPLATFORM_MIGRATION_DATABASE_URL=' +
          url.toString() +
          '\n',
        { mode: 0o600 },
      );
      const targets = [];
      for (const kind of ['billing', 'platform'] as const) {
        const db = new Client({
          connectionString:
            kind === 'billing' ? billing.connectionString : url.toString(),
        });
        try {
          await db.connect();
          const identity = await databaseIdentity(db);
          const keyFile = join(parent, kind + '.key');
          await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
          targets.push({
            id: kind,
            kind,
            envFile,
            expectedDatabase:
              kind === 'billing'
                ? decodeURIComponent(
                    new URL(billing.connectionString).pathname.slice(1),
                  )
                : name,
            databaseOid: identity.oid,
            cluster: identity.cluster,
            installationId: randomUUID(),
            keyFile,
            backupDirectory: join(parent, kind + '-archives'),
            workDirectory: join(parent, kind + '-work'),
            maximumAgeHours: 24,
            tools: { type: 'docker' as const, container: container! },
          });
        } finally {
          await db.end();
        }
      }
      profile = backupProfile.parse({
        version: 1,
        id: randomUUID(),
        recoveryKitAcknowledgedAt: new Date().toISOString(),
        targets,
        publicationDirectory: join(parent, 'auto-publication'),
      });
      await saveBackupProfile(directory, profile);
    }, 60000);
    afterAll(async () => {
      if (billingCandidate)
        await root.query(
          `DROP DATABASE IF EXISTS "${billingCandidate}" WITH(FORCE)`,
        );
      if (candidate)
        await root.query(`DROP DATABASE IF EXISTS "${candidate}" WITH(FORCE)`);
      await billing?.cleanup();
      await platform?.end();
      if (name)
        await root.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);
      await root?.end();
      if (
        parent &&
        resolve(parent).startsWith(resolve(parentRoot) + sep) &&
        basename(parent).startsWith('gst-backup-guided-')
      )
        await rm(parent, { recursive: true, force: true });
    });
    test('creates verified encrypted archives for both domains and publishes only sanitized status', async () => {
      await runBackupJob(directory, 'platform', 'backup');
      artifact = (await inspectJobs(directory, 'platform'))[0]!.artifact;
      expect(
        (
          await readFile(join(profile.targets[1]!.backupDirectory, artifact))
        ).includes(Buffer.from('Backup customer')),
      ).toBe(false);
      await runBackupJob(directory, 'billing', 'backup');
      expect(
        (await backupStatus(directory)).targets.map((target) => target.state),
      ).toEqual(['verified', 'verified']);
      const publication = join(parent, 'publication');
      expect(
        (
          await readBackupStatus(
            join(parent, 'auto-publication', 'backup-status.json'),
          )
        ).state,
      ).toBe('reported');
      await expect(publishBackupStatus(directory, directory)).rejects.toThrow(
        'SEPARATE_PUBLICATION_DIRECTORY_REQUIRED',
      );
      await publishBackupStatus(directory, publication);
      const response = await readBackupStatus(
        join(publication, 'backup-status.json'),
      );
      expect(response.state).toBe('reported');
      expect(JSON.stringify(response)).not.toContain('postgresql');
      expect(JSON.stringify(response)).not.toContain('keyFile');
      await expect(saveBackupProfile(directory, profile)).rejects.toThrow();
      await withTarget(profile.targets[0]!, async (_db, options) => {
        await expect(
          verifyRestore(
            options,
            join(profile.targets[1]!.backupDirectory, artifact),
          ),
        ).rejects.toThrow();
      });
    }, 120000);
    test('serializes jobs and rejects rebound database identities', async () => {
      const target = profile.targets[1]!;
      const url = new URL(authority!);
      url.pathname = '/' + name;
      const blocker = new Client({ connectionString: url.toString() });
      await blocker.connect();
      try {
        await blocker.query(
          "SELECT pg_advisory_lock(hashtextextended('gst-backup:'||current_database(),73492640))",
        );
        await expect(
          runBackupJob(directory, 'platform', 'backup'),
        ).rejects.toThrow('BACKUP_ALREADY_RUNNING');
      } finally {
        await blocker.end();
      }
      await expect(
        withTarget(
          { ...target, databaseOid: target.databaseOid + 1 },
          async () => {},
        ),
      ).rejects.toThrow('DATABASE_IDENTITY_MISMATCH');
    });
    test('seals platform recovery, revokes copied sessions and requires external history reconciliation', async () => {
      const result = await runBackupJob(
        directory,
        'platform',
        'recover',
        artifact,
      );
      recoveryJob = result.id;
      candidate = (await inspectJobs(directory, 'platform')).find(
        (value) => value.id === recoveryJob,
      )!.result!.recoveryDatabase!;
      expect(
        (
          await root.query(
            'SELECT datallowconn FROM pg_database WHERE datname=$1',
            [candidate],
          )
        ).rows[0].datallowconn,
      ).toBe(false);
      expect(
        (
          await platform.query(
            'SELECT operations_enabled FROM platform_control',
          )
        ).rows[0].operations_enabled,
      ).toBe(true);
      expect(
        (
          await platform.query(
            'SELECT count(*)::int AS count FROM platform_sessions',
          )
        ).rows[0].count,
      ).toBe(1);
      await root.query(`ALTER DATABASE "${candidate}" ALLOW_CONNECTIONS true`);
      const url = new URL(authority!);
      url.pathname = '/' + candidate;
      const db = store(url.toString());
      try {
        expect(
          (await db.query('SELECT operations_enabled FROM platform_control'))
            .rows[0].operations_enabled,
        ).toBe(false);
        expect(
          (
            await db.query(
              'SELECT count(*)::int AS count FROM platform_sessions',
            )
          ).rows[0].count,
        ).toBe(0);
        expect(
          (
            await db.query(
              "SELECT action FROM platform_audit WHERE action='backup.fixture'",
            )
          ).rows,
        ).toHaveLength(1);
        await expect(db.query('DELETE FROM platform_audit')).rejects.toThrow();
      } finally {
        await db.end();
        await root.query(
          `ALTER DATABASE "${candidate}" ALLOW_CONNECTIONS false`,
        );
      }
      expect(
        (await recoveryInventory(directory, 'platform')).artifacts.some(
          (item) => item.jobId === recoveryJob && item.candidatePlan,
        ),
      ).toBe(true);
      const receiptId = randomUUID();
      await billing.database.db.execute(
        sql`INSERT INTO platform_operator.receipts(id,kind,payload,result) VALUES(${receiptId},'pause','{}','{}')`,
      );
      const report = await reconcilePlatformRecovery(
        directory,
        'platform',
        recoveryJob,
      );
      expect(report.discrepancies).toContainEqual({
        id: receiptId,
        reason: 'SAAS_RECEIPT_MISSING_FROM_RESTORED_PLATFORM',
      });
      expect(report.publisherRegisterReviewRequired).toBe(true);
      expect(report.operationsRemainDisabled).toBe(true);
      expect(
        (
          await root.query(
            'SELECT datallowconn FROM pg_database WHERE datname=$1',
            [candidate],
          )
        ).rows[0].datallowconn,
      ).toBe(false);
    }, 120000);
    test('requires interruption review and never hides failed or tampered protection', async () => {
      const id = randomUUID();
      await saveNewFile(
        directory,
        'job-' + id + '.json',
        JSON.stringify({
          id,
          target: 'platform',
          action: 'backup',
          artifact: 'backup-' + id + '.gstplatformbackup',
          startedAt: new Date().toISOString(),
        }) + '\n',
      );
      await expect(
        runBackupJob(directory, 'platform', 'backup'),
      ).rejects.toThrow('INTERRUPTED_JOB_REQUIRES_INSPECTION');
      expect((await backupStatus(directory)).targets[1]?.state).toBe(
        'interrupted',
      );
      await acknowledgeInterruptedJob(directory, 'platform', id);
      await runBackupJob(directory, 'platform', 'verify', artifact);
      await appendFile(
        join(profile.targets[1]!.backupDirectory, artifact),
        'corrupt',
      );
      expect((await backupStatus(directory)).targets[1]?.state).toBe(
        'artifact_changed',
      );
      await expect(
        runBackupJob(directory, 'platform', 'verify', artifact),
      ).rejects.toThrow('BACKUP_JOB_FAILED');
      expect((await backupStatus(directory)).targets[1]?.state).toBe('failed');
      expect(await readdir(profile.targets[1]!.workDirectory)).toEqual([]);
    }, 120000);
    test('guided billing recovery selects recorded candidates and preserves switch confirmations', async () => {
      const archive = (await inspectJobs(directory, 'billing')).find(
        (job) => job.action === 'backup',
      )!.artifact;
      const prepared = await runBackupJob(
        directory,
        'billing',
        'recover',
        archive,
      );
      billingCandidate = (await inspectJobs(directory, 'billing')).find(
        (job) => job.id === prepared.id,
      )!.result!.recoveryDatabase!;
      const status = await billingRecoveryAction(
        directory,
        'billing',
        prepared.id,
        'status',
        billing.connectionString,
      );
      expect(status).toMatchObject({
        activeDatabase: profile.targets[0]!.expectedDatabase,
        recoveryDatabase: billingCandidate,
      });
      await expect(
        billingRecoveryAction(
          directory,
          'billing',
          prepared.id,
          'activate',
          billing.connectionString,
          false,
        ),
      ).rejects.toThrow();
      await expect(
        billingRecoveryAction(
          directory,
          'platform',
          recoveryJob,
          'activate',
          billing.connectionString,
          true,
        ),
      ).rejects.toThrow('BILLING_RECOVERY_REQUIRED');
      expect(
        (
          await root.query(
            'SELECT datallowconn FROM pg_database WHERE datname=$1',
            [billingCandidate],
          )
        ).rows[0].datallowconn,
      ).toBe(false);
    }, 120000);
  },
);
