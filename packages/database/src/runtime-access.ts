import { Client } from 'pg';
import { assertMigrationHistory, migrationDigest } from './backup-operator.js';

export class RuntimeAccessError extends Error {
  constructor() {
    super(
      'Runtime access provisioning failed. Check the quarantined recovery identity, dedicated role, existing privileges and trusted release schema.',
    );
  }
}
type Privilege =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'TRUNCATE'
  | 'REFERENCES'
  | 'TRIGGER'
  | 'MAINTAIN';
const privileges: Privilege[] = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
];
// Explicitly reviewed against current API queries. New tables never inherit
// automatic grants. Host recovery and schema migration stay operator-only.
const policy: Record<string, readonly Privilege[]> = {
  organizations: ['SELECT', 'UPDATE'],
  organization_entitlements: ['SELECT'],
  business_profiles: ['SELECT', 'INSERT', 'UPDATE'],
  gst_registrations: ['SELECT', 'INSERT', 'UPDATE'],
  customers: ['SELECT', 'INSERT', 'UPDATE'],
  catalog_items: ['SELECT', 'INSERT', 'UPDATE'],
  catalog_tax_revisions: ['SELECT', 'INSERT'],
  catalog_tax_reviews: ['SELECT', 'INSERT'],
  users: ['SELECT', 'INSERT', 'UPDATE'],
  organization_memberships: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  permissions: ['SELECT'],
  roles: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  role_permissions: ['SELECT', 'INSERT', 'DELETE'],
  membership_roles: ['SELECT', 'INSERT', 'DELETE'],
  sessions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  mfa_credentials: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  mfa_recovery_codes: ['SELECT', 'INSERT', 'DELETE'],
  owner_recovery: [],
  auth_throttle: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  audit_events: ['SELECT', 'INSERT'],
  invoices: ['SELECT', 'INSERT', 'UPDATE'],
  invoice_series: ['SELECT', 'INSERT', 'UPDATE'],
  invoice_snapshots: ['SELECT', 'INSERT'],
  invoice_lines: ['SELECT', 'INSERT'],
  invoice_tax_components: ['SELECT', 'INSERT'],
  invoice_cancellations: ['SELECT', 'INSERT'],
};
function allowed(schema: string, table: string, privilege: Privilege) {
  return schema === 'public' && (policy[table]?.includes(privilege) ?? false);
}
async function assertRole(db: Client, role: string) {
  const result = await db.query(
    `SELECT r.oid FROM pg_roles r WHERE r.rolname=$1
    AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolbypassrls AND r.rolname<>current_user
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba=r.oid)`,
    [role],
  );
  if (result.rows.length !== 1) throw new RuntimeAccessError();
  return Number(result.rows[0].oid);
}
async function assertPrivileges(db: Client, role: string, complete: boolean) {
  const schemas = await db.query(
    `SELECT nspname, has_schema_privilege($1,oid,'CREATE') AS create_access,
    has_schema_privilege($1,oid,'USAGE') AS usage_access,
    has_schema_privilege($1,oid,'USAGE WITH GRANT OPTION') AS delegable FROM pg_namespace
    WHERE nspname !~ '^pg_' AND nspname<>'information_schema'`,
    [role],
  );
  if (
    schemas.rows.some(
      (s) =>
        s.create_access ||
        s.delegable ||
        (s.nspname !== 'public' && s.usage_access),
    )
  )
    throw new RuntimeAccessError();
  const owners = await db.query(
    `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=$1))
    OR EXISTS (SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1))
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=$1)) AS owns_objects`,
    [role],
  );
  if (owners.rows[0]?.owns_objects) throw new RuntimeAccessError();
  const relations = await db.query(
    `SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')`,
    [],
  );
  if (
    relations.rows.length > 200 ||
    Object.keys(policy).some(
      (table) =>
        !relations.rows.some(
          (r) =>
            r.schema === 'public' &&
            r.name === table &&
            ['r', 'p'].includes(r.relkind),
        ),
    )
  )
    throw new RuntimeAccessError();
  const access = await db.query(
    `SELECT n.nspname AS schema,c.relname AS name,p.privilege,
    has_table_privilege($1,c.oid,p.privilege) AS granted,
    has_table_privilege($1,c.oid,p.privilege || ' WITH GRANT OPTION') AS delegable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest($2::text[]) AS p(privilege)
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')`,
    [role, privileges],
  );
  for (const row of access.rows) {
    const expected = allowed(row.schema, row.name, row.privilege);
    if (
      row.delegable ||
      (row.granted && !expected) ||
      (complete && expected && !row.granted)
    )
      throw new RuntimeAccessError();
  }
  // Detect column-only grants, including grant options hidden by a table-level
  // privilege check. Only the entitlement clock marker may be updated narrowly.
  const columns = await db.query(
    `SELECT n.nspname AS schema,c.relname AS name,a.attname,p.privilege,
    has_column_privilege($1,c.oid,a.attnum,p.privilege || ' WITH GRANT OPTION') AS delegable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(privilege)
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    AND ((NOT has_table_privilege($1,c.oid,p.privilege) AND has_column_privilege($1,c.oid,a.attnum,p.privilege))
      OR has_column_privilege($1,c.oid,a.attnum,p.privilege || ' WITH GRANT OPTION'))`,
    [role],
  );
  for (const row of columns.rows) {
    const clock =
      row.schema === 'public' &&
      row.name === 'organization_entitlements' &&
      row.attname === 'last_observed_at' &&
      row.privilege === 'UPDATE';
    if (
      row.delegable ||
      (!clock && !allowed(row.schema, row.name, row.privilege))
    )
      throw new RuntimeAccessError();
  }
  const database = await db.query(
    `SELECT has_database_privilege($1,current_database(),'CREATE') OR has_database_privilege($1,current_database(),'TEMPORARY') OR has_database_privilege($1,current_database(),'CONNECT WITH GRANT OPTION') AS unsafe,
    has_database_privilege($1,current_database(),'CONNECT') AS connect,
    has_schema_privilege($1,'public','USAGE') AS schema_usage,
    has_column_privilege($1,'public.organization_entitlements','last_observed_at','UPDATE') AS clock`,
    [role],
  );
  if (
    database.rows[0]?.unsafe ||
    (complete &&
      (!database.rows[0]?.connect ||
        !database.rows[0]?.schema_usage ||
        !database.rows[0]?.clock))
  )
    throw new RuntimeAccessError();
  for (const relation of relations.rows.filter((r) => r.relkind === 'S')) {
    const result = await db.query(
      "SELECT has_sequence_privilege($1,$2::oid,'USAGE,SELECT,UPDATE') AS granted",
      [role, relation.oid],
    );
    if (result.rows[0]?.granted) throw new RuntimeAccessError();
  }
}

export async function provisionRecoveryRuntime(options: {
  connectionString: string;
  database: string;
  confirmDatabase: string;
  installationId: string;
  runtimeRole: string;
}) {
  if (
    !/^gst_recovery_[a-f0-9]{32}$/.test(options.database) ||
    options.confirmDatabase !== options.database ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(options.runtimeRole) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      options.installationId,
    )
  )
    throw new RuntimeAccessError();
  let url: URL;
  try {
    url = new URL(options.connectionString);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.search ||
      url.hash ||
      decodeURIComponent(url.pathname.slice(1)) === options.database
    )
      throw new RuntimeAccessError();
  } catch {
    throw new RuntimeAccessError();
  }
  url.pathname = '/postgres';
  const admin = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  let candidate: Client | undefined;
  let opened = false;
  let transaction = false;
  try {
    await admin.connect();
    const database = await admin.query(
      'SELECT oid,datallowconn,datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_database WHERE datname=$1',
      [options.database],
    );
    const record = database.rows[0];
    if (!record || record.datallowconn || !record.owned)
      throw new RuntimeAccessError();
    const locked = await admin.query(
      'SELECT pg_try_advisory_lock(73492602,$1::int) AS locked',
      [Number(record.oid) | 0],
    );
    if (!locked.rows[0]?.locked) throw new RuntimeAccessError();
    // Recheck after acquiring the cross-invocation lock in the maintenance DB.
    const state = await admin.query(
      'SELECT datallowconn FROM pg_database WHERE datname=$1',
      [options.database],
    );
    if (state.rows[0]?.datallowconn !== false) throw new RuntimeAccessError();
    const roleId = await assertRole(admin, options.runtimeRole);
    const publicAccess = await admin.query(
      `SELECT EXISTS (SELECT 1 FROM pg_database d, LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee<>d.datdba AND NOT (a.grantee=$2::oid AND a.privilege_type='CONNECT' AND NOT a.is_grantable)) AS granted`,
      [options.database, roleId],
    );
    if (publicAccess.rows[0]?.granted) throw new RuntimeAccessError();
    const peers = await admin.query(
      'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1',
      [options.database],
    );
    if (peers.rows[0]?.count !== 0) throw new RuntimeAccessError();
    // Remove only this candidate's role CONNECT before briefly opening it for
    // the operator. Safe retries cannot expose it to an already granted role.
    await admin.query(
      `REVOKE CONNECT ON DATABASE "${options.database}" FROM "${options.runtimeRole}"`,
    );
    await admin.query(
      `ALTER DATABASE "${options.database}" ALLOW_CONNECTIONS true`,
    );
    opened = true;
    url.pathname = `/${options.database}`;
    candidate = new Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    });
    await candidate.connect();
    await candidate.query('BEGIN');
    transaction = true;
    await candidate.query("SET LOCAL lock_timeout='5s'");
    const digest = await migrationDigest();
    if ((await assertMigrationHistory(candidate)) !== digest)
      throw new RuntimeAccessError();
    const marker = await candidate.query(
      "SELECT metadata FROM public.audit_events WHERE action='recovery.prepared' ORDER BY created_at DESC LIMIT 1",
    );
    if (
      marker.rows[0]?.metadata?.installationId !== options.installationId ||
      marker.rows[0]?.metadata?.schemaDigest !== digest ||
      Number(
        (await candidate.query('SELECT count(*) FROM public.sessions')).rows[0]
          ?.count,
      ) !== 0
    )
      throw new RuntimeAccessError();
    await assertPrivileges(candidate, options.runtimeRole, false);
    for (const [table, grants] of Object.entries(policy))
      if (grants.length)
        await candidate.query(
          `GRANT ${grants.join(',')} ON TABLE public."${table}" TO "${options.runtimeRole}"`,
        );
    await candidate.query(
      `GRANT UPDATE (last_observed_at) ON public.organization_entitlements TO "${options.runtimeRole}"`,
    );
    await candidate.query(
      `GRANT USAGE ON SCHEMA public TO "${options.runtimeRole}"`,
    );
    // Seal before modifying database ACLs: ALTER DATABASE from the maintenance
    // connection must not wait for this transaction's GRANT CONNECT row lock.
    await admin.query(
      `ALTER DATABASE "${options.database}" ALLOW_CONNECTIONS false`,
    );
    opened = false;
    await candidate.query(
      `GRANT CONNECT ON DATABASE "${options.database}" TO "${options.runtimeRole}"`,
    );
    await assertRole(candidate, options.runtimeRole);
    await assertPrivileges(candidate, options.runtimeRole, true);
    await candidate.query(
      'INSERT INTO public.audit_events (action,metadata) VALUES ($1,$2::jsonb)',
      [
        'recovery.runtime_access',
        JSON.stringify({
          installationId: options.installationId,
          runtimeRole: options.runtimeRole,
          schemaDigest: digest,
        }),
      ],
    );
    await candidate.query('COMMIT');
    transaction = false;
    return {
      state: 'quarantined' as const,
      database: options.database,
      runtimeRole: options.runtimeRole,
      schemaDigest: digest,
    };
  } catch {
    throw new RuntimeAccessError();
  } finally {
    try {
      if (candidate) {
        try {
          if (transaction) await candidate.query('ROLLBACK');
        } finally {
          await candidate.end();
        }
      }
    } finally {
      try {
        if (opened)
          await admin.query(
            `ALTER DATABASE "${options.database}" ALLOW_CONNECTIONS false`,
          );
      } finally {
        await admin.end();
      }
    }
  }
}
