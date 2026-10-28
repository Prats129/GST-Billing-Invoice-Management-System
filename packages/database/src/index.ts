import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    application_name: 'gst-api',
  });
  // Handle idle-connection errors without logging credential-bearing driver messages.
  pool.on('error', () => {
    process.stderr.write('{"level":"error","event":"database_pool_error"}\n');
  });
  return {
    db: drizzle(pool, { schema }),
    async ready(): Promise<void> {
      await pool.query(
        'SELECT id, name, status, created_at FROM public.organizations LIMIT 0',
      );
      await pool.query(
        'SELECT u.id, m.organization_id, s.token_hash FROM public.users u LEFT JOIN public.organization_memberships m ON m.user_id=u.id LEFT JOIN public.sessions s ON s.user_id=u.id LIMIT 0',
      );
      const guard = await pool.query(
        "SELECT to_regprocedure('public.require_active_owner(uuid)') AS owner_guard",
      );
      if (!guard.rows[0]?.owner_guard)
        throw new Error('Security migration missing');
      await pool.query(
        'SELECT p.organization_id, r.gstin FROM public.business_profiles p LEFT JOIN public.gst_registrations r ON r.organization_id=p.organization_id LIMIT 0',
      );
      await pool.query(
        'SELECT c.id, t.gst_percent, v.reference FROM public.catalog_items c LEFT JOIN public.catalog_tax_revisions t ON t.organization_id=c.organization_id AND t.item_id=c.id LEFT JOIN public.catalog_tax_reviews v ON v.organization_id=t.organization_id AND v.revision_id=t.id LIMIT 0',
      );
      await pool.query(
        'SELECT id, version, archived_at FROM public.customers LIMIT 0',
      );
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;
export type DatabaseTransaction = Parameters<
  Parameters<Database['db']['transaction']>[0]
>[0];
export * from './schema.js';
export {
  sql,
  and,
  or,
  eq,
  gt,
  isNull,
  isNotNull,
  ilike,
  inArray,
  desc,
  asc,
} from 'drizzle-orm';
export { migrateDatabase } from './migrate.js';
