import { afterAll, beforeAll, expect, test, describe } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { Client, store } from './store.js';
import { secureDirectory } from '../../api/src/operations/release-staging.js';
import {
  newProfile,
  createProfile,
  loadProfile,
  clusterIdentity,
  resources,
  databaseUrl,
  profileEnvironments,
} from '../../../scripts/setup/workflow.js';
import type { SetupProfile } from '../../../scripts/setup/workflow.js';
import {
  runSetup,
  enableInitialOperations,
} from '../../../scripts/setup/runner.js';
import { diagnosePlatform } from './diagnostics.js';
import { config } from './config.js';

const authority = process.env.TEST_DATABASE_ADMIN_URL;
describe.skipIf(!authority)(
  'guided local bootstrap with dedicated disposable database identities',
  () => {
    let admin: Client, root: string;
    const privateParent =
      process.platform === 'win32'
        ? (process.env.LOCALAPPDATA ?? tmpdir())
        : tmpdir();
    const profiles: SetupProfile[] = [];
    const password = 'Guided test password ' + randomUUID();
    beforeAll(async () => {
      admin = new Client({ connectionString: authority });
      await admin.connect();
      root = await mkdtemp(join(privateParent, 'gst-guided-'));
      await secureDirectory(root);
    });
    afterAll(async () => {
      for (const p of profiles) {
        for (const database of resources(p).databases)
          await admin.query(
            `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
          );
        for (const role of resources(p).roles)
          await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      }
      await admin?.end();
      if (
        root &&
        resolve(root).startsWith(resolve(privateParent) + sep) &&
        basename(root).startsWith('gst-guided-')
      )
        await rm(root, { recursive: true, force: true });
    });
    async function profile(edition: 'offline' | 'saas' = 'offline') {
      const url = new URL(authority!);
      const p = newProfile({
        edition,
        slug: 'gs_' + randomUUID().replaceAll('-', '').slice(0, 12),
        host: url.hostname as '127.0.0.1',
        port: Number(url.port || '5432'),
        cluster: await clusterIdentity(admin),
        email: 'owner@example.test',
        name: 'Owner',
        organizationName: 'Example business',
      });
      profiles.push(p);
      const directory = join(root, p.slug);
      await createProfile(directory, p);
      return { p, directory };
    }
    test('offline fresh setup uses the reviewed runtime policy and preserves identity, secrets and password on rerun', async () => {
      const { p, directory } = await profile();
      await runSetup(admin, p, directory, password);
      const envBefore = await readFile(join(directory, 'billing.env'), 'utf8');
      const db = store(
        databaseUrl(p, p.slug + '_billing', p.slug + '_billing_migrator'),
      );
      try {
        const before = await db.query('SELECT id,password_hash FROM users');
        expect(before.rows).toHaveLength(1);
        await runSetup(
          admin,
          await loadProfile(directory),
          directory,
          'Ignored on completed rerun',
        );
        expect(
          (await db.query('SELECT id,password_hash FROM users')).rows,
        ).toEqual(before.rows);
        expect((await db.query('SELECT id FROM organizations')).rowCount).toBe(
          1,
        );
        expect(await readFile(join(directory, 'billing.env'), 'utf8')).toBe(
          envBefore,
        );
      } finally {
        await db.end();
      }
    }, 60000);
    test('SaaS fresh setup provisions a restricted operator and platform owner with processing disabled', async () => {
      const { p, directory } = await profile('saas');
      await runSetup(admin, p, directory, password);
      const env = profileEnvironments(p),
        db = store(env.platformEnv.PLATFORM_DATABASE_URL!),
        operator = store(env.platformEnv.SAAS_OPERATOR_DATABASE_URL!);
      try {
        const result = await diagnosePlatform(
          db,
          { operator, config: config(env.platformEnv) },
          false,
        );
        expect(result.checks).toContainEqual({
          code: 'WORKER_DISABLED',
          state: 'blocked',
        });
        expect(result.checks).toContainEqual({
          code: 'SAAS_OPERATOR_READY',
          state: 'ready',
        });
        expect(result.checks).toContainEqual({
          code: 'SAAS_TARGET_MATCHED',
          state: 'ready',
        });
        expect(
          (await db.query('SELECT email,mfa_secret FROM platform_owner')).rows,
        ).toEqual([{ email: p.email, mfa_secret: null }]);
        await expect(
          operator.query('SELECT * FROM invoices'),
        ).rejects.toMatchObject({ code: '42501' });
        await runSetup(admin, p, directory, '');
        expect(
          (await db.query('SELECT operations_enabled FROM platform_control'))
            .rows[0].operations_enabled,
        ).toBe(false);
        await enableInitialOperations(admin, p, directory);
        expect(
          (await db.query('SELECT operations_enabled FROM platform_control'))
            .rows[0].operations_enabled,
        ).toBe(true);
        const authority = store(
          env.operatorEnv.PLATFORM_MIGRATION_DATABASE_URL!,
        );
        try {
          await authority.query(
            'UPDATE platform_control SET operations_enabled=false',
          );
        } finally {
          await authority.end();
        }
        await enableInitialOperations(admin, p, directory);
        expect(
          (await db.query('SELECT operations_enabled FROM platform_control'))
            .rows[0].operations_enabled,
        ).toBe(false);
      } finally {
        await db.end();
        await operator.end();
      }
    }, 60000);
    test('owner commit followed by interruption is reconciled without another account or organization', async () => {
      const { p, directory } = await profile();
      await expect(
        runSetup(admin, p, directory, password, (step) => {
          if (step.startsWith('5/5'))
            throw new Error('Simulated process interruption');
        }),
      ).rejects.toThrow();
      const db = store(
        profileEnvironments(p).operatorEnv.MIGRATION_DATABASE_URL!,
      );
      try {
        const original = await db.query('SELECT id,password_hash FROM users');
        const extra = await db.query<{ id: string }>(
          "INSERT INTO users(edition,email,name,password_hash) VALUES('offline','conflict@example.test','Conflicting account','unused fixture hash') RETURNING id",
        );
        await expect(
          runSetup(admin, await loadProfile(directory), directory, ''),
        ).rejects.toMatchObject({ code: 'OWNER_STATE_CONFLICT' });
        expect(
          (
            await db.query('SELECT id,password_hash FROM users WHERE id=$1', [
              original.rows[0].id,
            ])
          ).rows,
        ).toEqual(original.rows);
        expect((await db.query('SELECT id FROM users')).rowCount).toBe(2);
        await db.query('DELETE FROM users WHERE id=$1', [extra.rows[0]!.id]);
        await runSetup(admin, await loadProfile(directory), directory, '');
        expect((await db.query('SELECT id FROM users')).rowCount).toBe(1);
        expect((await db.query('SELECT id FROM organizations')).rowCount).toBe(
          1,
        );
      } finally {
        await db.end();
      }
    }, 60000);
    test('unrelated database collision is refused before any new roles are created', async () => {
      const { p, directory } = await profile();
      await admin.query(`CREATE DATABASE "${p.slug}_billing"`);
      await expect(
        runSetup(admin, p, directory, password),
      ).rejects.toMatchObject({ code: 'EXISTING_RESOURCE_CONFLICT' });
      expect(
        (
          await admin.query(
            'SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',
            [resources(p).roles],
          )
        ).rowCount,
      ).toBe(0);
    });
    test('unknown database creation outcome is never adopted by name', async () => {
      const { p, directory } = await profile();
      await expect(
        runSetup(admin, p, directory, password, (step) => {
          if (step.startsWith('2/5')) throw new Error('Stop after resources');
        }),
      ).rejects.toThrow();
      await admin.query(`COMMENT ON DATABASE "${p.slug}_billing" IS NULL`);
      await expect(
        runSetup(admin, p, directory, password),
      ).rejects.toMatchObject({ code: 'EXISTING_RESOURCE_CONFLICT' });
      expect(
        (
          await admin.query('SELECT oid FROM pg_database WHERE datname=$1', [
            p.slug + '_billing',
          ])
        ).rowCount,
      ).toBe(1);
    });
    test('a replaced database identity is rejected on a completed rerun', async () => {
      const { p, directory } = await profile();
      await runSetup(admin, p, directory, password);
      await admin.query(`DROP DATABASE "${p.slug}_billing" WITH (FORCE)`);
      await admin.query(
        `CREATE DATABASE "${p.slug}_billing" OWNER "${p.slug}_billing_migrator"`,
      );
      await admin.query(
        `COMMENT ON DATABASE "${p.slug}_billing" IS 'gst-guided-setup:${p.id}'`,
      );
      await expect(
        runSetup(admin, p, directory, password),
      ).rejects.toMatchObject({ code: 'DATABASE_IDENTITY_MISMATCH' });
    }, 60000);
    test('an active setup lock prevents another connection from starting the same profile', async () => {
      const { p, directory } = await profile();
      const other = new Client({ connectionString: authority });
      await other.connect();
      try {
        await other.query(
          'SELECT pg_advisory_lock(hashtextextended($1,73492611))',
          [p.slug],
        );
        await expect(
          runSetup(admin, p, directory, password),
        ).rejects.toMatchObject({ code: 'SETUP_BUSY' });
      } finally {
        await other.end();
      }
    });
    test('worker initialization refuses existing directory/history instead of treating it as new', async () => {
      const { p, directory } = await profile('saas');
      await runSetup(admin, p, directory, password);
      const db = store(
        profileEnvironments(p).operatorEnv.PLATFORM_MIGRATION_DATABASE_URL!,
      );
      try {
        await db.query(
          "INSERT INTO platform_organizations(id,runtime_id,edition,name,email,state) VALUES($1,$2,'saas','Existing','existing@example.test','pending')",
          [randomUUID(), randomUUID()],
        );
        await expect(
          enableInitialOperations(admin, p, directory),
        ).rejects.toMatchObject({ code: 'FULL_RECONCILIATION_REQUIRED' });
        expect(
          (await db.query('SELECT operations_enabled FROM platform_control'))
            .rows[0].operations_enabled,
        ).toBe(false);
        await db.query('UPDATE platform_control SET operations_enabled=true');
        await expect(
          enableInitialOperations(admin, p, directory),
        ).rejects.toMatchObject({ code: 'FULL_RECONCILIATION_REQUIRED' });
      } finally {
        await db.end();
      }
    }, 60000);
  },
);
