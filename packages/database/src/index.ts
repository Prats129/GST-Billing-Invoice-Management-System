import { Pool } from 'pg';
import { assertDatabaseReadiness } from './readiness.js';
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
      await assertDatabaseReadiness((sql) => pool.query(sql));
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
