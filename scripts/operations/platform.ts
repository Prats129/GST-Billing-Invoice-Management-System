import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Client } from '../../apps/admin-api/src/store.js';
import type { BackupOperatorOptions } from '../../packages/database/src/backup-operator.js';

// Host-only adapter. Never imported by the platform runtime or a browser.
export async function platformBackupAdapter(): Promise<
  NonNullable<BackupOperatorOptions['databaseAdapter']>
> {
  const sql = await readFile(
    fileURLToPath(
      new URL(
        '../../apps/admin-api/migrations/0001_platform.sql',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  const digest = createHash('sha256').update(sql).digest('hex');
  const tables = [...sql.matchAll(/CREATE TABLE (platform_[a-z_]+)/g)]
    .map((match) => match[1]!)
    .concat('platform_migrations')
    .sort();
  return {
    kind: 'platform',
    schemaDigest: digest,
    async validate(db: Client) {
      const foreign = await db.query(
        "SELECT to_regclass('public.organizations') AS name",
      );
      const history = await db.query(
        'SELECT version,digest FROM platform_migrations ORDER BY version',
      );
      const actual = await db.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      );
      if (
        foreign.rows[0]?.name ||
        history.rows.length !== 1 ||
        history.rows[0].version !== 1 ||
        history.rows[0].digest !== digest ||
        JSON.stringify(actual.rows.map((row) => row.tablename)) !==
          JSON.stringify(tables)
      )
        throw new Error('PLATFORM_SCHEMA_MISMATCH');
      const control = await db.query(
        'SELECT operations_enabled FROM platform_control',
      );
      const triggers = await db.query(
        "SELECT count(*)::int AS count FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname=ANY($1::text[])",
        [
          [
            'audit_immutable',
            'receipts_immutable',
            'adjustments_immutable',
            'requests_immutable',
            'grants_immutable',
            'delivery_immutable',
          ],
        ],
      );
      const financial = await db.query(`SELECT EXISTS(
        SELECT 1 FROM platform_agreements a WHERE
          coalesce((SELECT sum(r.amount_paise) FROM platform_receipts r WHERE r.agreement_id=a.id),0)
          -coalesce((SELECT sum(j.amount_paise) FROM platform_adjustments j WHERE j.agreement_id=a.id),0) NOT BETWEEN 0 AND a.total_paise
        UNION ALL SELECT 1 FROM platform_receipts r WHERE
          coalesce((SELECT sum(j.amount_paise) FROM platform_adjustments j WHERE j.receipt_id=r.id),0)>r.amount_paise
      ) AS invalid`);
      if (
        control.rows.length !== 1 ||
        triggers.rows[0]?.count !== 6 ||
        financial.rows[0]?.invalid
      )
        throw new Error('PLATFORM_INTEGRITY_CHECK_FAILED');
    },
    async quarantine(db: Client, context) {
      await db.query('UPDATE platform_control SET operations_enabled=false');
      const removed = await db.query('DELETE FROM platform_sessions');
      // Keep operation state/payloads and MFA/recovery material as evidence.
      // No automatic replay, grant issuance or authority enablement after restore.
      await db.query(
        "INSERT INTO platform_audit(action,metadata) VALUES('recovery.prepared',$1::jsonb)",
        [
          JSON.stringify({
            domain: 'platform',
            ...context,
            schemaDigest: digest,
            sessionsInvalidated: removed.rowCount ?? 0,
            reconciliationRequired: true,
          }),
        ],
      );
      return removed.rowCount ?? 0;
    },
  };
}
