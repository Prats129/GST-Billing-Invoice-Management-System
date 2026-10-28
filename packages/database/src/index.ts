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
export { sql, and, eq, gt, isNull, inArray, desc, asc } from 'drizzle-orm';
export { migrateDatabase } from './migrate.js';
