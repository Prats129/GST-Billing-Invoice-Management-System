import { Client } from 'pg';
import { win32 } from 'node:path';
import { assertMigrationHistory, migrationDigest } from './backup-operator.js';
import {
  assertRuntimeRole,
  assertRuntimePrivileges,
} from './runtime-access.js';
import { assertDatabaseReadiness } from './readiness.js';

// Repair verification only. No CREATE, DROP, migration, GRANT, owner provisioning
// or password change is performed. A different cluster/schema is never adopted.
export async function verifyRetainedDatabase(options: {
  adminConnectionString: string;
  ownerConnectionString: string;
  runtimeConnectionString: string;
  expectedDataDirectory: string;
  systemIdentifier: string;
  schemaDigest: string;
}) {
  const clients: Client[] = [];
  try {
    const adminUrl = new URL(options.adminConnectionString),
      ownerUrl = new URL(options.ownerConnectionString),
      runtimeUrl = new URL(options.runtimeConnectionString);
    for (const url of [adminUrl, ownerUrl, runtimeUrl])
      if (
        url.hostname !== '127.0.0.1' ||
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.search ||
        url.hash ||
        url.host !== adminUrl.host
      )
        throw new Error();
    if (
      adminUrl.pathname !== '/postgres' ||
      ownerUrl.pathname !== '/gst_billing' ||
      runtimeUrl.pathname !== ownerUrl.pathname ||
      decodeURIComponent(ownerUrl.username) !== 'gst_owner' ||
      decodeURIComponent(runtimeUrl.username) !== 'gst_runtime' ||
      options.schemaDigest !== (await migrationDigest()) ||
      !/^\d+$/.test(options.systemIdentifier)
    )
      throw new Error();
    const connect = async (connectionString: string) => {
      const db = new Client({
        connectionString,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
      });
      clients.push(db);
      await db.connect();
      await db.query('SET default_transaction_read_only=on');
      return db;
    };
    const admin = await connect(options.adminConnectionString);
    const fact = (
      await admin.query(
        "SELECT current_setting('data_directory') AS directory, current_setting('server_version_num')::int AS version,(SELECT system_identifier::text FROM pg_control_system()) AS identifier",
      )
    ).rows[0];
    const normalized = (v: string) =>
      process.platform === 'win32' ? win32.normalize(v).toLowerCase() : v;
    if (
      !fact ||
      fact.identifier !== options.systemIdentifier ||
      fact.version < 180000 ||
      fact.version >= 190000 ||
      normalized(fact.directory) !== normalized(options.expectedDataDirectory)
    )
      throw new Error();
    const owner = await connect(options.ownerConnectionString);
    if ((await assertMigrationHistory(owner)) !== options.schemaDigest)
      throw new Error();
    const owned = (
      await owner.query(
        'SELECT datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_database WHERE datname=current_database()',
      )
    ).rows[0];
    if (!owned?.owned) throw new Error();
    await assertRuntimeRole(owner, 'gst_runtime');
    await assertRuntimePrivileges(owner, 'gst_runtime', true);
    const runtime = await connect(options.runtimeConnectionString);
    await assertDatabaseReadiness((sql) => runtime.query(sql));
    return {
      systemIdentifier: options.systemIdentifier,
      schemaDigest: options.schemaDigest,
    };
  } catch {
    throw new Error(
      'Retained database identity, schema or access verification failed. Existing data was not changed.',
    );
  } finally {
    await Promise.all(clients.map((db) => db.end()));
  }
}
