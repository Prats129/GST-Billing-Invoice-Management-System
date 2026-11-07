import type { Pool } from 'pg';
import type { PlatformDiagnostics } from '@gst/contracts/platform';
import type { PlatformConfig } from './config.js';

// Catalog-only probes: never invoke an operator mutation or read tenant records.
export async function diagnosePlatform(
  db: Pick<Pool, 'query'>,
  operations: {
    operator: Pick<Pool, 'query'> | undefined;
    config: Pick<
      PlatformConfig,
      'SAAS_EXPECTED_DATABASE_NAME' | 'SAAS_APP_ORIGIN'
    >;
  },
  trustConfigured: boolean,
): Promise<PlatformDiagnostics> {
  const checks: PlatformDiagnostics['checks'] = [];
  try {
    const { rows } = await db.query<{ operations_enabled: boolean }>(
      'SELECT operations_enabled FROM platform_control',
    );
    if (!rows[0]) throw new Error('Missing control record');
    checks.push({
      code: rows[0]?.operations_enabled ? 'WORKER_ENABLED' : 'WORKER_DISABLED',
      state: rows[0]?.operations_enabled ? 'ready' : 'blocked',
    });
  } catch {
    checks.push({ code: 'PLATFORM_CONTROL_UNAVAILABLE', state: 'blocked' });
  }
  if (!operations.operator) {
    checks.push({ code: 'SAAS_NOT_CONFIGURED', state: 'blocked' });
  } else {
    try {
      const { rows } = await operations.operator.query<{
        target_matches: boolean | null;
        routines_present: boolean;
        permitted: boolean;
        restricted: boolean;
      }>(
        `SELECT current_database()=$1::text AS target_matches,
          to_regprocedure('platform_operator.lookup(uuid)') IS NOT NULL
          AND to_regprocedure('platform_operator.execute(uuid,text,jsonb)') IS NOT NULL AS routines_present,
          coalesce(has_schema_privilege(current_user,(SELECT oid FROM pg_namespace WHERE nspname='platform_operator'),'USAGE'),false)
          AND coalesce(has_function_privilege(current_user,to_regprocedure('platform_operator.lookup(uuid)'),'EXECUTE'),false)
          AND coalesce(has_function_privilege(current_user,to_regprocedure('platform_operator.execute(uuid,text,jsonb)'),'EXECUTE'),false) AS permitted,
          NOT EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls))
          AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user))
          AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user))
          AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
          AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
          AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
          AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname IN ('invoices','customers','catalog_items')
            AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
          AND NOT has_schema_privilege(current_user,'public','CREATE') AS restricted`,
        [operations.config.SAAS_EXPECTED_DATABASE_NAME ?? null],
      );
      const row = rows[0];
      if (!row) throw new Error('Missing diagnostic result');
      checks.push({ code: 'SAAS_REACHABLE', state: 'ready' });
      checks.push({
        code:
          row.target_matches === null
            ? 'SAAS_TARGET_UNCONFIRMED'
            : row.target_matches
              ? 'SAAS_TARGET_MATCHED'
              : 'SAAS_TARGET_MISMATCH',
        state: row.target_matches ? 'ready' : 'blocked',
      });
      checks.push({
        code: !row.routines_present
          ? 'SAAS_MIGRATIONS_REQUIRED'
          : !row.permitted
            ? 'SAAS_PERMISSIONS_REQUIRED'
            : !row.restricted
              ? 'SAAS_ROLE_UNSAFE'
              : 'SAAS_OPERATOR_READY',
        state:
          row.routines_present && row.permitted && row.restricted
            ? 'ready'
            : 'blocked',
      });
    } catch {
      // Database errors can contain connection credentials or private SQL details.
      checks.push({ code: 'SAAS_PROBE_FAILED', state: 'blocked' });
    }
  }
  checks.push({
    code: operations.config.SAAS_APP_ORIGIN
      ? 'SAAS_ORIGIN_CONFIGURED'
      : 'SAAS_ORIGIN_MISSING',
    state: operations.config.SAAS_APP_ORIGIN ? 'ready' : 'blocked',
  });
  checks.push({
    code: trustConfigured ? 'TRUST_CONFIGURED' : 'TRUST_MISSING',
    state: trustConfigured ? 'ready' : 'blocked',
  });
  return { checkedAt: new Date().toISOString(), checks };
}
