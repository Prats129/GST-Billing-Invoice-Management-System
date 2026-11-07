import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, open, link, unlink, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { emailSchema } from '../../packages/contracts/dist/index.js';
import { Client } from '../../apps/admin-api/src/store.js';
import { migrateDatabase } from '../../packages/database/src/migrate.js';
import {
  applyRuntimePolicy,
  assertRuntimePrivileges,
} from '../../packages/database/src/runtime-access.js';
import {
  secureDirectory,
  assertPrivateDirectory,
} from '../../apps/api/src/operations/release-staging.js';

export class SetupError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const setupProfileSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    edition: z.enum(['offline', 'saas']),
    slug: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/),
    host: z.enum(['127.0.0.1', 'localhost', '::1']),
    port: z.number().int().min(1).max(65535),
    cluster: z.string().regex(/^\d+$/),
    installationId: z.string().uuid(),
    authKey: z.string().regex(/^[a-f0-9]{64}$/),
    platformKey: z.string().regex(/^[a-f0-9]{64}$/),
    recovery: z.string().regex(/^[a-f0-9]{64}$/),
    email: emailSchema,
    name: z.string().trim().min(1).max(120),
    organizationName: z.string().trim().min(1).max(200),
    credentials: z.record(identifier, z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict();
export type SetupProfile = z.infer<typeof setupProfileSchema>;
export function resources(p: Pick<SetupProfile, 'slug' | 'edition'>) {
  const billing = p.slug + '_billing',
    platform = p.slug + '_platform';
  return {
    databases: p.edition === 'saas' ? [billing, platform] : [billing],
    roles:
      p.edition === 'saas'
        ? [
            billing + '_migrator',
            billing + '_runtime',
            platform + '_migrator',
            platform + '_runtime',
            p.slug + '_operator',
          ]
        : [billing + '_migrator', billing + '_runtime'],
  };
}
export function newProfile(
  input: Omit<
    SetupProfile,
    | 'version'
    | 'id'
    | 'installationId'
    | 'authKey'
    | 'platformKey'
    | 'recovery'
    | 'credentials'
  >,
): SetupProfile {
  const hex = () => randomBytes(32).toString('hex');
  // Validate names before deriving identifiers or ever constructing SQL.
  if (!/^[a-z][a-z0-9_]{0,19}$/.test(input.slug))
    throw new SetupError('INVALID_PROFILE_NAME');
  return setupProfileSchema.parse({
    ...input,
    version: 1,
    id: randomUUID(),
    installationId: randomUUID(),
    authKey: hex(),
    platformKey: hex(),
    recovery: hex(),
    credentials: Object.fromEntries(
      resources(input).roles.map((role) => [role, hex()]),
    ),
  });
}
export function databaseUrl(p: SetupProfile, database: string, role: string) {
  const password = p.credentials[role];
  if (!password || !resources(p).databases.includes(database))
    throw new SetupError('INVALID_RESOURCE');
  const url = new URL('postgresql://localhost/postgres');
  url.hostname = p.host === '::1' ? '[::1]' : p.host;
  url.port = String(p.port);
  url.username = role;
  url.password = password;
  url.pathname = '/' + database;
  return url.toString();
}
export async function saveNewFile(
  directory: string,
  name: string,
  content: string,
) {
  if (!/^[a-z0-9_.-]+$/.test(name)) throw new SetupError('INVALID_FILE_NAME');
  await assertPrivateDirectory(directory);
  const path = join(directory, name);
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 65536 ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    )
      throw new SetupError('UNSAFE_PROFILE_FILE');
    if ((await readFile(path, 'utf8')) !== content)
      throw new SetupError('EXISTING_FILE_CONFLICT');
    return;
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ))
      throw error;
  }
  const temporary = join(directory, '.prepared-' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
    // Flush the published name before any database operation relies on its keys.
    const committed = await open(path, 'r+');
    try {
      await committed.sync();
    } finally {
      await committed.close();
    }
    if (process.platform !== 'win32') {
      const parent = await open(directory, 'r');
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
  } finally {
    await unlink(temporary);
  }
}
export async function createProfile(directory: string, profile: SetupProfile) {
  setupProfileSchema.parse(profile);
  await mkdir(directory, { mode: 0o700 }); // Existing directories are never adopted.
  await secureDirectory(directory);
  await saveNewFile(
    directory,
    'profile.json',
    JSON.stringify(profile, null, 2) + '\n',
  );
}
export async function loadProfile(directory: string) {
  await assertPrivateDirectory(directory);
  const file = join(directory, 'profile.json'),
    info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 16384 ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  )
    throw new SetupError('UNSAFE_PROFILE_FILE');
  const profile = setupProfileSchema.parse(
    JSON.parse(await readFile(file, 'utf8')),
  );
  if (
    Object.keys(profile.credentials).sort().join() !==
    resources(profile).roles.sort().join()
  )
    throw new SetupError('PROFILE_RESOURCE_MISMATCH');
  return profile;
}
export async function clusterIdentity(client: Client) {
  const authority = await client.query<{ permitted: boolean }>(
    'SELECT rolsuper AS permitted FROM pg_roles WHERE rolname=current_user',
  );
  if (!authority.rows[0]?.permitted)
    throw new SetupError('LOCAL_DATABASE_ADMIN_REQUIRED');
  const result = await client.query<{ id: string; permitted: boolean }>(
    'SELECT system_identifier::text AS id,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS permitted FROM pg_control_system()',
  );
  if (!result.rows[0]?.permitted)
    throw new SetupError('LOCAL_DATABASE_ADMIN_REQUIRED');
  return result.rows[0].id;
}
async function event(directory: string, value: object) {
  await assertPrivateDirectory(directory);
  const file = await open(join(directory, 'progress.jsonl'), 'a', 0o600);
  try {
    await file.writeFile(
      JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n',
    );
    await file.sync();
  } finally {
    await file.close();
  }
}
// Only this setup's tagged resources can be resumed. A missing database tag after
// CREATE DATABASE is ambiguous: stop, preserve everything, and require inspection.
export async function prepareDatabases(
  client: Client,
  profile: SetupProfile,
  directory: string,
) {
  setupProfileSchema.parse(profile);
  if ((await clusterIdentity(client)) !== profile.cluster)
    throw new SetupError('DATABASE_CLUSTER_MISMATCH');
  const marker = 'gst-guided-setup:' + profile.id;
  const { roles, databases } = resources(profile);
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,73492611))', [
    profile.slug,
  ]);
  try {
    const existing = await client.query<{
      rolname: string;
      marker: string | null;
    }>(
      "SELECT rolname,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=ANY($1::text[])",
      [roles],
    );
    const dbs = await client.query<{
      datname: string;
      marker: string | null;
      oid: number;
    }>(
      "SELECT datname,oid,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=ANY($1::text[])",
      [databases],
    );
    if (
      existing.rows.some((r) => r.marker !== marker) ||
      dbs.rows.some((r) => r.marker !== marker)
    )
      throw new SetupError('EXISTING_RESOURCE_CONFLICT');
    if (existing.rows.length && existing.rows.length !== roles.length)
      throw new SetupError('PARTIAL_ROLE_STATE');
    const previousRoles = await readFile(
      join(directory, 'roles.identity'),
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
    if (previousRoles && !existing.rows.length)
      throw new SetupError('ROLE_IDENTITY_MISMATCH');
    for (const name of databases) {
      const previous = await readFile(
        join(directory, name + '.identity'),
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
      if (
        previous !== undefined &&
        previous !== String(dbs.rows.find((row) => row.datname === name)?.oid)
      )
        throw new SetupError('DATABASE_IDENTITY_MISMATCH');
    }
    await event(directory, {
      step: 'resources',
      state: 'prepared',
      cluster: profile.cluster,
    });
    if (!existing.rows.length) {
      await client.query('BEGIN');
      try {
        for (const role of roles) {
          const password = profile.credentials[role];
          if (!password || !/^[a-f0-9]{64}$/.test(password))
            throw new SetupError('PROFILE_RESOURCE_MISMATCH');
          await client.query(
            `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
          );
          await client.query(`COMMENT ON ROLE "${role}" IS '${marker}'`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    const identities = await client.query<{ oid: number; rolname: string }>(
      'SELECT oid,rolname FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname',
      [roles],
    );
    await saveNewFile(
      directory,
      'roles.identity',
      JSON.stringify(identities.rows),
    );
    for (const database of databases) {
      const owner = database + '_migrator';
      if (!dbs.rows.some((d) => d.datname === database)) {
        await event(directory, {
          step: 'database',
          name: database,
          state: 'prepared',
        });
        await client.query(
          `CREATE DATABASE "${database}" TEMPLATE template0 OWNER "${owner}"`,
        );
        await client.query(`COMMENT ON DATABASE "${database}" IS '${marker}'`);
      }
      const check = await client.query<{ oid: number; owner: string }>(
        'SELECT oid,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',
        [database],
      );
      if (check.rows[0]?.owner !== owner)
        throw new SetupError('DATABASE_OWNER_MISMATCH');
      const evidenceName = database + '.identity';
      await saveNewFile(directory, evidenceName, String(check.rows[0].oid));
      await client.query(
        `REVOKE CONNECT,TEMPORARY ON DATABASE "${database}" FROM PUBLIC`,
      );
      await client.query(
        `GRANT CONNECT ON DATABASE "${database}" TO "${database}_runtime"`,
      );
      await event(directory, {
        step: 'database',
        name: database,
        state: 'verified',
        oid: check.rows[0].oid,
      });
    }
  } finally {
    await client.query(
      'SELECT pg_advisory_unlock(hashtextextended($1,73492611))',
      [profile.slug],
    );
  }
}
export function profileEnvironments(p: SetupProfile) {
  const billing = p.slug + '_billing',
    platform = p.slug + '_platform';
  const billingEnv: Record<string, string> = {
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3000',
    APP_ORIGIN: 'http://127.0.0.1:5173',
    ALLOWED_HOSTS: '127.0.0.1:3000,127.0.0.1:5173',
    DEPLOYMENT_EDITION: p.edition,
    DATABASE_URL: databaseUrl(p, billing, billing + '_runtime'),
    AUTH_DATA_KEY: p.authKey,
    ...(p.edition === 'offline'
      ? { OFFLINE_INSTALLATION_ID: p.installationId }
      : {}),
  };
  const platformEnv: Record<string, string> =
    p.edition === 'saas'
      ? {
          NODE_ENV: 'development',
          PLATFORM_HOST: '127.0.0.1',
          PLATFORM_PORT: '3001',
          PLATFORM_ORIGIN: 'http://127.0.0.1:5174',
          PLATFORM_DATABASE_URL: databaseUrl(
            p,
            platform,
            platform + '_runtime',
          ),
          PLATFORM_AUTH_KEY: p.platformKey,
          SAAS_OPERATOR_DATABASE_URL: databaseUrl(
            p,
            billing,
            p.slug + '_operator',
          ),
          SAAS_APP_ORIGIN: billingEnv.APP_ORIGIN!,
          SAAS_EXPECTED_DATABASE_NAME: billing,
        }
      : {};
  const operatorEnv: Record<string, string> = {
    MIGRATION_DATABASE_URL: databaseUrl(p, billing, billing + '_migrator'),
    ...(p.edition === 'saas'
      ? {
          PLATFORM_MIGRATION_DATABASE_URL: databaseUrl(
            p,
            platform,
            platform + '_migrator',
          ),
          SAAS_MIGRATION_DATABASE_URL: databaseUrl(
            p,
            billing,
            billing + '_migrator',
          ),
        }
      : {}),
  };
  return { billingEnv, platformEnv, operatorEnv };
}
export async function writeEnvironments(p: SetupProfile, directory: string) {
  const env = profileEnvironments(p);
  for (const [name, values] of [
    ['billing.env', env.billingEnv],
    ['admin.env', env.platformEnv],
    ['operator.env', env.operatorEnv],
  ] as const) {
    if (!Object.keys(values).length) continue;
    await saveNewFile(
      directory,
      name,
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
    );
  }
  return env;
}
export async function migrateBilling(p: SetupProfile) {
  const database = p.slug + '_billing';
  const url = databaseUrl(p, database, database + '_migrator');
  await migrateDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await applyRuntimePolicy(client, database + '_runtime');
    await assertRuntimePrivileges(client, database + '_runtime', true);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
