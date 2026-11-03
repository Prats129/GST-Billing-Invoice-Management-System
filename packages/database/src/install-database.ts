import { Client } from 'pg';
import { win32 } from 'node:path';
import { migrateDatabase } from './migrate.js';
import { createDatabase } from './index.js';
import {
  applyRuntimePolicy,
  assertRuntimePrivileges,
} from './runtime-access.js';
import { migrationDigest } from './backup-operator.js';

// Initial installation only. Never runs against an existing application database
// or adopts customer roles. Failures retain the new database/roles for inspection.
export async function initializeOfflineDatabase(options: {
  adminConnectionString: string;
  expectedDataDirectory: string;
  installationId: string;
  ownerPassword: string;
  runtimePassword: string;
}) {
  let phase = 'validation';
  const admin = new Client({
    connectionString: options.adminConnectionString,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  try {
    const url = new URL(options.adminConnectionString);
    if (
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/postgres' ||
      url.search ||
      url.hash ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !/^[a-f0-9]{64}$/.test(options.ownerPassword) ||
      !/^[a-f0-9]{64}$/.test(options.runtimePassword) ||
      options.ownerPassword === options.runtimePassword ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
        options.installationId,
      ) ||
      decodeURIComponent(url.password) === options.ownerPassword ||
      decodeURIComponent(url.password) === options.runtimePassword
    )
      throw new Error();
    phase = 'cluster-identity';
    await admin.connect();
    const facts = (
      await admin.query(
        "SELECT current_setting('data_directory') AS directory, current_setting('server_version_num')::int AS version, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, (SELECT system_identifier::text FROM pg_control_system()) AS identifier",
      )
    ).rows[0];
    const normalize = (value: string) =>
      process.platform === 'win32'
        ? win32.normalize(value).toLowerCase()
        : value;
    if (
      !facts?.superuser ||
      facts.version < 180000 ||
      facts.version >= 190000 ||
      normalize(facts.directory) !== normalize(options.expectedDataDirectory)
    )
      throw new Error();
    phase = 'fresh-cluster';
    if (
      (
        await admin.query(
          "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname <> current_user AND rolname NOT LIKE 'pg\\_%' ESCAPE '\\') AS collision",
        )
      ).rows[0]?.collision
    )
      throw new Error();
    phase = 'dedicated-roles';
    // Prevent password-bearing DDL from appearing in server statement/error logs.
    await admin.query("SET log_statement='none'");
    await admin.query("SET log_min_error_statement='panic'");
    await admin.query("SET log_error_verbosity='terse'");
    await admin.query('BEGIN');
    try {
      await admin.query(
        `CREATE ROLE gst_owner LOGIN PASSWORD '${options.ownerPassword}' NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(
        `CREATE ROLE gst_runtime LOGIN PASSWORD '${options.runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query('COMMIT');
    } catch {
      await admin.query('ROLLBACK');
      throw new Error();
    }
    phase = 'new-database';
    await admin.query(
      'CREATE DATABASE gst_billing OWNER gst_owner TEMPLATE template0 ALLOW_CONNECTIONS false',
    );
    await admin.query('REVOKE ALL ON DATABASE gst_billing FROM PUBLIC');
    await admin.query('ALTER DATABASE gst_billing ALLOW_CONNECTIONS true');
    const owner = new URL(url);
    owner.username = 'gst_owner';
    owner.password = options.ownerPassword;
    owner.pathname = '/gst_billing';
    phase = 'migrations';
    await migrateDatabase(owner.toString());
    const connection = new Client({
      connectionString: owner.toString(),
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    });
    try {
      await connection.connect();
      await connection.query('BEGIN');
      phase = 'runtime-policy';
      await applyRuntimePolicy(connection, 'gst_runtime');
      await connection.query(
        'GRANT CONNECT ON DATABASE gst_billing TO gst_runtime',
      );
      await assertRuntimePrivileges(connection, 'gst_runtime', true);
      phase = 'audit';
      await connection.query(
        'INSERT INTO public.audit_events(action,metadata) VALUES($1,$2::jsonb)',
        [
          'installation.database_initialized',
          JSON.stringify({
            installationId: options.installationId,
            schemaDigest: await migrationDigest(),
            systemIdentifier: facts.identifier,
          }),
        ],
      );
      await connection.query('COMMIT');
    } finally {
      await connection.end();
    }
    phase = 'runtime-connection';
    const runtime = new URL(owner);
    runtime.username = 'gst_runtime';
    runtime.password = options.runtimePassword;
    const db = createDatabase(runtime.toString());
    try {
      await db.ready();
    } finally {
      await db.close();
    }
    return {
      database: 'gst_billing',
      systemIdentifier: String(facts.identifier),
      schemaDigest: await migrationDigest(),
    };
  } catch {
    throw new Error(
      `Initial database provisioning failed (${phase}). Retain the new cluster and inspect installer evidence; never rerun against existing data.`,
    );
  } finally {
    await admin.end();
  }
}
