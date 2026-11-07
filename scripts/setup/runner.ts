import { spawn } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../../packages/security/dist/index.js';
import { passwordSchema } from '../../packages/contracts/dist/index.js';
import { createDatabase } from '../../packages/database/src/index.js';
import { IdentityService } from '../../apps/api/src/security/identity.service.js';
import { OrganizationsService } from '../../apps/api/src/security/organizations.service.js';
import { parseConfig } from '../../apps/api/src/config.js';
import { PlatformAuth } from '../../apps/admin-api/src/auth.js';
import { config } from '../../apps/admin-api/src/config.js';
import {
  store,
  migratePlatform,
  transaction,
  audit,
} from '../../apps/admin-api/src/store.js';
import type { Client } from '../../apps/admin-api/src/store.js';
import {
  SetupError,
  resources,
  profileEnvironments,
  saveNewFile,
  prepareDatabases,
  migrateBilling,
  writeEnvironments,
  clusterIdentity,
} from './workflow.js';
import type { SetupProfile } from './workflow.js';

export function runtimeEnvironment(
  values: Record<string, string>,
  parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(parent).filter(
      ([key]) =>
        !/^(PG|PLATFORM_|SAAS_|POSTGRES_|AUTH_|ENTITLEMENT_|OFFLINE_|DATABASE_URL$|MIGRATION_DATABASE_URL$|DEPLOYMENT_EDITION$|ENV_FILE$|NODE_ENV$|HOST$|PORT$|APP_ORIGIN$|ALLOWED_HOSTS$|TLS_|WEB_ROOT$|SESSION_)/i.test(
          key,
        ),
    ),
  );
  return { ...clean, ...values };
}
async function operatorCommand(
  directory: string,
  values: Record<string, string>,
  command: 'runtime-role' | 'saas-role',
  role: string,
) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/admin-api/src/operator-cli.ts', command, '-'],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 30000,
      env: runtimeEnvironment({
        ...values,
        PLATFORM_RUNTIME_ENV_FILE: join(directory, 'admin.env'),
        PLATFORM_ENV_FILE: join(directory, 'operator.env'),
      }),
    },
  );
  await new Promise<void>((yes, no) => {
    child.once('error', () =>
      no(new SetupError('PERMISSION_TOOL_UNAVAILABLE')),
    );
    child.once('exit', (code) =>
      code === 0 ? yes() : no(new SetupError('PERMISSION_STEP_FAILED')),
    );
    child.stdin.on('error', () =>
      no(new SetupError('PERMISSION_INPUT_FAILED')),
    );
    child.stdin.end(JSON.stringify({ role }));
  });
}
async function verifyResources(
  admin: Client,
  p: SetupProfile,
  directory: string,
) {
  if ((await clusterIdentity(admin)) !== p.cluster)
    throw new SetupError('DATABASE_CLUSTER_MISMATCH');
  const { roles, databases } = resources(p),
    marker = 'gst-guided-setup:' + p.id;
  const identities = await admin.query(
    'SELECT oid,rolname FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname',
    [roles],
  );
  if (
    (await readFile(join(directory, 'roles.identity'), 'utf8')) !==
    JSON.stringify(identities.rows)
  )
    throw new SetupError('ROLE_IDENTITY_MISMATCH');
  for (const name of databases) {
    const r = await admin.query<{ oid: number; owner: string; marker: string }>(
      "SELECT oid,pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",
      [name],
    );
    if (r.rows[0]?.owner !== name + '_migrator' || r.rows[0]?.marker !== marker)
      throw new SetupError('DATABASE_IDENTITY_MISMATCH');
    // Comparison only: never recreate missing evidence for an allegedly complete profile.
    if (
      (await readFile(join(directory, name + '.identity'), 'utf8')) !==
      String(r.rows[0].oid)
    )
      throw new SetupError('DATABASE_IDENTITY_MISMATCH');
  }
}
async function owner(p: SetupProfile, directory: string, password: string) {
  const env = profileEnvironments(p);
  if (p.edition === 'saas') {
    const db = store(env.operatorEnv.PLATFORM_MIGRATION_DATABASE_URL!);
    try {
      const result = await db.query<{
        id: string;
        email: string;
        recovery_hash: string;
      }>('SELECT id,email,recovery_hash FROM platform_owner');
      if (result.rows.length) {
        const current = result.rows[0];
        if (
          !current ||
          result.rows.length !== 1 ||
          current.email !== p.email ||
          current.recovery_hash !== digest(p.recovery)
        )
          throw new SetupError('OWNER_STATE_CONFLICT');
      } else {
        passwordSchema.parse(password);
        await new PlatformAuth(db, config(env.platformEnv)).bootstrap(
          p.email,
          p.name,
          password,
          p.recovery,
        );
      }
      const verified = await db.query<{ id: string }>(
        'SELECT id FROM platform_owner WHERE email=$1 AND recovery_hash=$2',
        [p.email, digest(p.recovery)],
      );
      if (!verified.rows[0]) throw new SetupError('OWNER_STATE_CONFLICT');
      await saveNewFile(directory, 'owner.identity', verified.rows[0].id);
    } finally {
      await db.end();
    }
  } else {
    const db = createDatabase(env.operatorEnv.MIGRATION_DATABASE_URL!);
    const probe = store(env.operatorEnv.MIGRATION_DATABASE_URL!);
    try {
      const existing = await probe.query<{
        id: string;
        email: string;
        token_hash: string;
        organization_name: string;
      }>(
        `SELECT u.id,u.email,r.token_hash,o.name AS organization_name FROM users u
         LEFT JOIN owner_recovery r ON r.user_id=u.id LEFT JOIN organization_memberships m ON m.user_id=u.id AND m.is_owner
         LEFT JOIN organizations o ON o.id=m.organization_id LIMIT 2`,
      );
      if (existing.rows.length) {
        const current = existing.rows[0];
        if (
          !current ||
          existing.rows.length !== 1 ||
          current.email !== p.email ||
          current.token_hash !== digest(p.recovery) ||
          current.organization_name !== p.organizationName
        )
          throw new SetupError('OWNER_STATE_CONFLICT');
      } else {
        passwordSchema.parse(password);
        await new OrganizationsService(
          new IdentityService(db, parseConfig(env.billingEnv)),
        ).provisionOwner(
          {
            email: p.email,
            name: p.name,
            password,
            organizationName: p.organizationName,
          },
          p.recovery,
        );
      }
      const verified = await probe.query<{ user_id: string }>(
        'SELECT user_id FROM owner_recovery WHERE token_hash=$1',
        [digest(p.recovery)],
      );
      if (!verified.rows[0]) throw new SetupError('OWNER_STATE_CONFLICT');
      await saveNewFile(directory, 'owner.identity', verified.rows[0].user_id);
    } finally {
      await db.close();
      await probe.end();
    }
  }
}
export async function runSetup(
  admin: Client,
  p: SetupProfile,
  directory: string,
  password: string,
  progress: (message: string) => void = () => {},
) {
  directory = resolve(directory);
  const lock = await admin.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(hashtextextended($1,73492611)) AS acquired',
    [p.slug],
  );
  if (!lock.rows[0]?.acquired) throw new SetupError('SETUP_BUSY');
  try {
    const complete = await lstat(join(directory, 'complete.json')).catch(
      (e: unknown) => {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')
          return undefined;
        throw e;
      },
    );
    if (complete) {
      if (
        !complete.isFile() ||
        complete.isSymbolicLink() ||
        complete.size > 1024
      )
        throw new SetupError('INVALID_COMPLETION_RECORD');
      if (
        (await readFile(join(directory, 'complete.json'), 'utf8')) !==
        JSON.stringify({ id: p.id, cluster: p.cluster }) + '\n'
      )
        throw new SetupError('INVALID_COMPLETION_RECORD');
      await verifyResources(admin, p, directory);
      progress(
        'Already completed. Existing accounts, settings and worker state were preserved.',
      );
      return;
    }
    progress('1/5 Creating or verifying this profile’s database identities');
    await prepareDatabases(admin, p, directory);
    const env = await writeEnvironments(p, directory);
    progress(
      '2/5 Applying reviewed billing migrations and runtime permissions',
    );
    await migrateBilling(p);
    if (p.edition === 'saas') {
      progress(
        '3/5 Applying platform migrations and restricted operator permissions',
      );
      const db = store(env.operatorEnv.PLATFORM_MIGRATION_DATABASE_URL!);
      try {
        await migratePlatform(db);
      } finally {
        await db.end();
      }
      const values = { ...env.platformEnv, ...env.operatorEnv };
      await operatorCommand(
        directory,
        values,
        'runtime-role',
        p.slug + '_platform_runtime',
      );
      await operatorCommand(
        directory,
        values,
        'saas-role',
        p.slug + '_operator',
      );
    }
    await verifyResources(admin, p, directory);
    progress('4/5 Creating or reconciling the initial owner');
    await owner(p, directory, password);
    progress('5/5 Verifying runtime connections');
    for (const connectionString of [
      env.billingEnv.DATABASE_URL,
      env.platformEnv.PLATFORM_DATABASE_URL,
      env.platformEnv.SAAS_OPERATOR_DATABASE_URL,
    ].filter((v): v is string => Boolean(v))) {
      const db = store(connectionString);
      try {
        await db.query('SELECT 1');
      } finally {
        await db.end();
      }
    }
    await saveNewFile(
      directory,
      'complete.json',
      JSON.stringify({ id: p.id, cluster: p.cluster }) + '\n',
    );
  } finally {
    await admin.query(
      'SELECT pg_advisory_unlock(hashtextextended($1,73492611))',
      [p.slug],
    );
  }
}

// This is not restore reconciliation. Only an unused, identity-verified fresh
// profile may take this path, and a saved receipt prevents future reenabling.
export async function enableInitialOperations(
  admin: Client,
  p: SetupProfile,
  directory: string,
) {
  if (p.edition !== 'saas') throw new SetupError('SAAS_PROFILE_REQUIRED');
  directory = resolve(directory);
  const lock = await admin.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(hashtextextended($1,73492611)) AS acquired',
    [p.slug],
  );
  if (!lock.rows[0]?.acquired) throw new SetupError('SETUP_BUSY');
  try {
    await verifyResources(admin, p, directory);
    const receipt = JSON.stringify({ id: p.id, cluster: p.cluster }) + '\n';
    if ((await readFile(join(directory, 'complete.json'), 'utf8')) !== receipt)
      throw new SetupError('SETUP_INCOMPLETE');
    const old = await readFile(
      join(directory, 'worker-enabled.json'),
      'utf8',
    ).catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return undefined;
      throw error;
    });
    if (old !== undefined) {
      if (old !== receipt) throw new SetupError('WORKER_RECEIPT_CONFLICT');
      return 'preserved' as const; // Never remove later host-managed disables.
    }
    const env = profileEnvironments(p),
      platform = store(env.operatorEnv.PLATFORM_MIGRATION_DATABASE_URL!),
      billing = store(env.operatorEnv.MIGRATION_DATABASE_URL!);
    try {
      await transaction(platform, async (tx) => {
        await tx.query(
          'LOCK TABLE platform_organizations,platform_operations,platform_grants,platform_license_requests IN SHARE MODE',
        );
        const state = await tx.query<{ operations_enabled: boolean }>(
          'SELECT operations_enabled FROM platform_control FOR UPDATE',
        );
        if (!state.rows[0])
          throw new SetupError('PLATFORM_CONTROL_UNAVAILABLE');
        const populated = await tx.query<{ present: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM platform_organizations) OR EXISTS(SELECT 1 FROM platform_operations) OR EXISTS(SELECT 1 FROM platform_grants) OR EXISTS(SELECT 1 FROM platform_license_requests) AS present',
        );
        const runtime = await billing.query<{ present: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM organizations) OR EXISTS(SELECT 1 FROM platform_operator.receipts) AS present',
        );
        if (populated.rows[0]?.present || runtime.rows[0]?.present)
          throw new SetupError('FULL_RECONCILIATION_REQUIRED');
        if (!state.rows[0].operations_enabled) {
          await saveNewFile(directory, 'worker-enable-prepared.json', receipt);
          await tx.query('UPDATE platform_control SET operations_enabled=true');
          await audit(tx, null, 'operations.authority_enabled');
        }
      });
      await saveNewFile(directory, 'worker-enabled.json', receipt);
      return 'enabled' as const;
    } finally {
      await platform.end();
      await billing.end();
    }
  } finally {
    await admin.query(
      'SELECT pg_advisory_unlock(hashtextextended($1,73492611))',
      [p.slug],
    );
  }
}
