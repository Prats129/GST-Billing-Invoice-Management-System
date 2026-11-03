import { Client } from 'pg';
import { assertMigrationHistory } from './backup-operator.js';
import { assertRuntimeRole } from './runtime-access.js';

function local(value: string) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.search ||
    url.hash
  )
    throw new Error('Local operator connection required.');
  return url;
}
export function updateConnections(operator: string, runtime: string) {
  const admin = local(operator),
    api = local(runtime);
  const database = decodeURIComponent(admin.pathname.slice(1));
  const role = decodeURIComponent(api.username);
  if (
    !/^[a-z_][a-z0-9_]{0,62}$/.test(database) ||
    /^(postgres|template0|template1)$/.test(database) ||
    /^gst_(recovery|previous)_/.test(database) ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(role) ||
    api.hostname !== admin.hostname ||
    (api.port || '5432') !== (admin.port || '5432') ||
    api.pathname !== admin.pathname ||
    api.username === admin.username
  )
    throw new Error(
      'Dedicated matching operator/runtime connections required.',
    );
  return { database, role };
}
const connect = (url: URL) =>
  new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });

// Owner inspection of either the active database or a sealed generated copy.
// The candidate's runtime CONNECT is withheld throughout its temporary opening.
export async function inspectUpdateDatabase<T>(
  options: {
    connectionString: string;
    runtimeConnectionString: string;
    candidate?: string;
    idle?: boolean;
  },
  inspect: (client: Client, schemaDigest: string) => Promise<T>,
): Promise<T> {
  const { database, role } = updateConnections(
    options.connectionString,
    options.runtimeConnectionString,
  );
  const target = options.candidate ?? database;
  if (options.candidate && !/^gst_recovery_[a-f0-9]{32}$/.test(target))
    throw new Error('Generated candidate required.');
  const url = local(options.connectionString);
  url.pathname = '/postgres';
  const admin = connect(url);
  let reader: Client | undefined;
  let opened = false;
  let revoked = false;
  try {
    await admin.connect();
    const state = await admin.query(
      'SELECT oid::int AS oid, datallowconn AS open, datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_database WHERE datname=$1 AND NOT datistemplate',
      [target],
    );
    const row = state.rows[0];
    if (!row?.owned || row.open !== !options.candidate)
      throw new Error('Unexpected database identity/state.');
    if (
      !(
        await admin.query(
          'SELECT pg_try_advisory_lock(73492602,$1::int) AS locked',
          [row.oid],
        )
      ).rows[0]?.locked
    )
      throw new Error('Database operation already running.');
    if (options.idle || options.candidate) {
      const busy = await admin.query(
        'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1) OR EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=$1) AS busy',
        [target],
      );
      if (busy.rows[0]?.busy)
        throw new Error('Database writers must be stopped.');
    }
    if (options.candidate) {
      await assertRuntimeRole(admin, role);
      // Provisioning has already applied the reviewed owner/runtime-only ACL.
      const unsafe = await admin.query(
        `SELECT EXISTS(SELECT 1 FROM pg_database d, LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee<>d.datdba AND NOT(a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$2) AND a.privilege_type='CONNECT' AND NOT a.is_grantable)) AS unsafe, has_database_privilege($2,$1,'CONNECT') AS connect`,
        [target, role],
      );
      if (unsafe.rows[0]?.unsafe || !unsafe.rows[0]?.connect)
        throw new Error('Unexpected candidate access.');
      await admin.query(
        `REVOKE CONNECT ON DATABASE "${target}" FROM "${role}"`,
      );
      revoked = true;
      opened = true;
      await admin.query(`ALTER DATABASE "${target}" ALLOW_CONNECTIONS true`);
    }
    url.pathname = `/${target}`;
    reader = connect(url);
    await reader.connect();
    if (options.candidate) {
      await admin.query(`ALTER DATABASE "${target}" ALLOW_CONNECTIONS false`);
      opened = false;
    }
    await reader.query('BEGIN READ ONLY');
    await reader.query('SET LOCAL row_security = off');
    const result = await inspect(reader, await assertMigrationHistory(reader));
    await reader.query('COMMIT');
    return result;
  } finally {
    try {
      await reader?.end();
    } finally {
      try {
        if (opened)
          await admin.query(
            `ALTER DATABASE "${target}" ALLOW_CONNECTIONS false`,
          );
        if (revoked)
          await admin.query(
            `GRANT CONNECT ON DATABASE "${target}" TO "${role}"`,
          );
      } finally {
        await admin.end();
      }
    }
  }
}

export async function readUpdateOrganizations(client: Client) {
  const result = await client.query<{
    id: string;
    edition: string;
    signed_grant: unknown;
    highest_sequence: number | null;
    last_observed_at: Date | null;
  }>(
    'SELECT o.id,o.edition,e.signed_grant,e.highest_sequence,e.last_observed_at FROM public.organizations o LEFT JOIN public.organization_entitlements e ON e.organization_id=o.id ORDER BY o.id',
  );
  return result.rows.map((r) => ({
    id: r.id,
    edition: r.edition,
    entitlement:
      r.highest_sequence === null || r.last_observed_at === null
        ? null
        : {
            signedGrant: r.signed_grant,
            highestSequence: r.highest_sequence,
            lastObservedAt: r.last_observed_at,
          },
  }));
}
