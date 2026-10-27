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
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;
export { organizations } from './schema.js';
export { migrateDatabase } from './migrate.js';
