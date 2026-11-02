import { Client } from 'pg';
import { createDatabase } from './index.js';
import { assertMigrationHistory, migrationDigest } from './backup-operator.js';
import {
  assertRuntimePrivileges,
  assertRuntimeRole,
} from './runtime-access.js';

export class RecoverySwitchError extends Error {
  constructor() {
    super(
      'Recovery switch failed. Keep the application stopped and inspect database names, connection flags and the recovery record before retrying.',
    );
  }
}
export interface RecoverySwitchOptions {
  connectionString: string;
  runtimeConnectionString: string;
  recoveryDatabase: string;
  confirmActiveDatabase: string;
  installationId: string;
  confirmWritersStopped: boolean;
  confirmRollbackDataLoss?: boolean;
}
function localUrl(value: string) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.search ||
    url.hash
  )
    throw new RecoverySwitchError();
  return url;
}
function inputs(options: RecoverySwitchOptions) {
  try {
    const operator = localUrl(options.connectionString);
    const runtime = localUrl(options.runtimeConnectionString);
    const active = decodeURIComponent(operator.pathname.slice(1));
    const role = decodeURIComponent(runtime.username);
    if (
      !/^[a-z_][a-z0-9_]{0,62}$/.test(active) ||
      ['postgres', 'template0', 'template1'].includes(active) ||
      /^gst_(recovery|previous)_/.test(active) ||
      !/^gst_recovery_[a-f0-9]{32}$/.test(options.recoveryDatabase) ||
      active !== options.confirmActiveDatabase ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(role) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        options.installationId,
      ) ||
      runtime.hostname !== operator.hostname ||
      (runtime.port || '5432') !== (operator.port || '5432') ||
      decodeURIComponent(runtime.pathname.slice(1)) !== active
    )
      throw new RecoverySwitchError();
    operator.pathname = '/postgres';
    return {
      operator,
      runtime,
      active,
      role,
      previous: options.recoveryDatabase.replace(
        'gst_recovery_',
        'gst_previous_',
      ),
    };
  } catch {
    throw new RecoverySwitchError();
  }
}
function client(url: URL) {
  return new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
}
async function records(admin: Client, names: string[]) {
  return (
    await admin.query<{
      name: string;
      oid: number;
      open: boolean;
      owned: boolean;
    }>(
      `SELECT datname AS name,oid::int AS oid,datallowconn AS open,
    datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND NOT datistemplate AS owned
    FROM pg_database WHERE datname=ANY($1::text[]) ORDER BY datname`,
      [names],
    )
  ).rows;
}
async function idle(admin: Client, names: string[]) {
  const busy = await admin.query(
    `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=ANY($1::text[]))
    OR EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=ANY($1::text[])) AS busy`,
    [names],
  );
  if (busy.rows[0]?.busy) throw new RecoverySwitchError();
}
// Read-only catalog inspection is also usable after a lost COMMIT acknowledgement.
// It reports observed names/flags, not an assertion that business data is correct.
export async function recoverySwitchStatus(options: RecoverySwitchOptions) {
  const value = inputs(options);
  const admin = client(value.operator);
  try {
    await admin.connect();
    const databases = await records(admin, [
      value.active,
      value.previous,
      options.recoveryDatabase,
    ]);
    return {
      activeDatabase: value.active,
      recoveryDatabase: options.recoveryDatabase,
      previousDatabase: value.previous,
      databases,
    };
  } catch {
    throw new RecoverySwitchError();
  } finally {
    await admin.end();
  }
}

export async function switchRecovery(
  options: RecoverySwitchOptions,
  action: 'activate' | 'rollback',
) {
  const value = inputs(options);
  if (
    !options.confirmWritersStopped ||
    !['activate', 'rollback'].includes(action) ||
    (action === 'rollback' && !options.confirmRollbackDataLoss)
  )
    throw new RecoverySwitchError();
  const admin = client(value.operator);
  const names = [value.active, value.previous, options.recoveryDatabase];
  let transaction = false;
  try {
    await admin.connect();
    let state = await records(admin, names);
    const active = state.find((r) => r.name === value.active);
    const otherName =
      action === 'activate' ? options.recoveryDatabase : value.previous;
    const other = state.find((r) => r.name === otherName);
    if (
      state.length !== 2 ||
      !active?.owned ||
      !active.open ||
      !other?.owned ||
      other.open
    )
      throw new RecoverySwitchError();
    for (const oid of [active.oid, other.oid].sort((a, b) => a - b)) {
      const lock = await admin.query(
        'SELECT pg_try_advisory_lock(73492602,$1::int) AS locked',
        [oid],
      );
      if (!lock.rows[0]?.locked) throw new RecoverySwitchError();
    }
    if (JSON.stringify(await records(admin, names)) !== JSON.stringify(state))
      throw new RecoverySwitchError();
    await idle(admin, names);
    await assertRuntimeRole(admin, value.role);
    const digest = await migrationDigest();
    if (action === 'activate') {
      const roleId = await assertRuntimeRole(admin, value.role);
      const acl = await admin.query(
        `SELECT EXISTS(SELECT 1 FROM pg_database d,
        LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
        WHERE d.datname=$1 AND a.grantee<>d.datdba
        AND NOT(a.grantee=$2::oid AND a.privilege_type='CONNECT' AND NOT a.is_grantable)) AS unsafe,
        has_database_privilege($2::oid,$1::text,'CONNECT') AS connect`,
        [otherName, roleId],
      );
      if (acl.rows[0]?.unsafe || !acl.rows[0]?.connect)
        throw new RecoverySwitchError();
      // Keep runtime out of the candidate while operator-only validation runs.
      await admin.query(
        `REVOKE CONNECT ON DATABASE "${otherName}" FROM "${value.role}"`,
      );
      const url = new URL(value.operator);
      url.pathname = `/${otherName}`;
      const candidate = client(url);
      try {
        await admin.query(
          `ALTER DATABASE "${otherName}" ALLOW_CONNECTIONS true`,
        );
        await candidate.connect();
        await admin.query(
          `ALTER DATABASE "${otherName}" ALLOW_CONNECTIONS false`,
        );
        await candidate.query('BEGIN');
        if ((await assertMigrationHistory(candidate)) !== digest)
          throw new RecoverySwitchError();
        const marker = await candidate.query(
          "SELECT metadata FROM public.audit_events WHERE action='recovery.prepared' ORDER BY created_at DESC LIMIT 1",
        );
        const grants = await candidate.query(
          "SELECT metadata FROM public.audit_events WHERE action='recovery.runtime_access' ORDER BY created_at DESC LIMIT 1",
        );
        if (
          marker.rows[0]?.metadata?.installationId !== options.installationId ||
          marker.rows[0]?.metadata?.schemaDigest !== digest ||
          grants.rows[0]?.metadata?.installationId !== options.installationId ||
          grants.rows[0]?.metadata?.runtimeRole !== value.role ||
          grants.rows[0]?.metadata?.schemaDigest !== digest ||
          Number(
            (await candidate.query('SELECT count(*) FROM public.sessions'))
              .rows[0]?.count,
          ) !== 0
        )
          throw new RecoverySwitchError();
        await candidate.query(
          `GRANT CONNECT ON DATABASE "${otherName}" TO "${value.role}"`,
        );
        await assertRuntimePrivileges(candidate, value.role, true);
        await candidate.query(
          'INSERT INTO public.audit_events(action,metadata) VALUES($1,$2::jsonb)',
          [
            'recovery.cutover_prepared',
            JSON.stringify({
              installationId: options.installationId,
              activeDatabase: value.active,
              recoveryDatabase: otherName,
              previousDatabase: value.previous,
              previousOid: active.oid,
              recoveredOid: other.oid,
              runtimeRole: value.role,
              schemaDigest: digest,
            }),
          ],
        );
        await candidate.query('COMMIT');
      } finally {
        // Ending a connection rolls back an unfinished candidate transaction.
        try {
          await candidate.end();
        } finally {
          await admin.query(
            `ALTER DATABASE "${otherName}" ALLOW_CONNECTIONS false`,
          );
        }
      }
    } else {
      // Only a matching retained pair can be reversed; never guess from names alone.
      const url = new URL(value.operator);
      url.pathname = `/${value.active}`;
      const recovered = client(url);
      try {
        await recovered.connect();
        if ((await assertMigrationHistory(recovered)) !== digest)
          throw new RecoverySwitchError();
        const marker = (
          await recovered.query(
            "SELECT metadata FROM public.audit_events WHERE action='recovery.cutover_prepared' ORDER BY created_at DESC LIMIT 1",
          )
        ).rows[0]?.metadata;
        if (
          !marker ||
          marker.installationId !== options.installationId ||
          marker.schemaDigest !== digest ||
          marker.activeDatabase !== value.active ||
          marker.previousDatabase !== value.previous ||
          marker.recoveryDatabase !== options.recoveryDatabase ||
          marker.previousOid !== other.oid ||
          marker.recoveredOid !== active.oid ||
          marker.runtimeRole !== value.role
        )
          throw new RecoverySwitchError();
        await recovered.query(
          'INSERT INTO public.audit_events(action,metadata) VALUES($1,$2::jsonb)',
          ['recovery.rollback_prepared', JSON.stringify(marker)],
        );
      } finally {
        await recovered.end();
      }
    }
    // Both directions authenticate and check API readiness on the target before
    // changing names. Never switch back to an unreadable old copy.
    const runtimeUrl = new URL(value.runtime);
    runtimeUrl.pathname = `/${otherName}`;
    const runtime = createDatabase(runtimeUrl.toString());
    try {
      await admin.query(`ALTER DATABASE "${otherName}" ALLOW_CONNECTIONS true`);
      await runtime.ready();
    } finally {
      try {
        await admin.query(
          `ALTER DATABASE "${otherName}" ALLOW_CONNECTIONS false`,
        );
      } finally {
        await runtime.close();
      }
    }
    await idle(admin, names);
    await admin.query('BEGIN');
    transaction = true;
    await admin.query("SET LOCAL lock_timeout='5s'");
    await admin.query('SET LOCAL synchronous_commit=on');
    state = await records(admin, names);
    if (
      state.length !== 2 ||
      !state.some(
        (r) =>
          r.name === value.active && r.oid === active.oid && r.open && r.owned,
      ) ||
      !state.some(
        (r) =>
          r.name === otherName && r.oid === other.oid && !r.open && r.owned,
      )
    )
      throw new RecoverySwitchError();
    await admin.query(
      `ALTER DATABASE "${value.active}" ALLOW_CONNECTIONS false`,
    );
    // PostgreSQL's rename locks reject racing clients/prepared transactions.
    // The names and connection flags commit together; no config file is edited.
    const retired =
      action === 'activate' ? value.previous : options.recoveryDatabase;
    await admin.query(
      `ALTER DATABASE "${value.active}" RENAME TO "${retired}"`,
    );
    await admin.query(
      `ALTER DATABASE "${otherName}" RENAME TO "${value.active}"`,
    );
    await admin.query(
      `ALTER DATABASE "${value.active}" ALLOW_CONNECTIONS true`,
    );
    await admin.query('COMMIT');
    transaction = false;
    return {
      state: action === 'activate' ? 'activated' : 'rolled_back',
      activeDatabase: value.active,
      recoveryDatabase: options.recoveryDatabase,
      previousDatabase: value.previous,
      activeOid: other.oid,
      retainedOid: active.oid,
    };
  } catch {
    throw new RecoverySwitchError();
  } finally {
    try {
      if (transaction) await admin.query('ROLLBACK');
    } finally {
      await admin.end();
    }
  }
}
