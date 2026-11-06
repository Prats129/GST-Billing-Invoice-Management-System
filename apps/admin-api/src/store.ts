export { Client } from 'pg';
import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export type Tx = PoolClient;
export function store(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    application_name: 'gst-platform',
  });
  pool.on('error', () =>
    process.stderr.write('{"event":"platform_database_error"}\n'),
  );
  return pool;
}
export async function transaction<T>(
  pool: Pool,
  action: (tx: Tx) => Promise<T>,
) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SET LOCAL lock_timeout='5s'");
    const result = await action(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}
export async function rows<T extends QueryResultRow>(
  tx: Pick<Pool, 'query'> | Tx,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return (await tx.query<T>(sql, args)).rows;
}
export async function migratePlatform(pool: Pool) {
  const sql = await readFile(
    fileURLToPath(new URL('../migrations/0001_platform.sql', import.meta.url)),
    'utf8',
  );
  const hash = createHash('sha256').update(sql).digest('hex');
  await transaction(pool, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73492609)');
    // Refuse accidental use of the customer database.
    const [foreign] = await rows<{ name: string | null }>(
      tx,
      "SELECT to_regclass('public.organizations')::text AS name",
    );
    if (foreign?.name) throw new Error('Separate platform database required');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS platform_migrations(version integer PRIMARY KEY, digest text NOT NULL)',
    );
    const [old] = await rows<{ digest: string }>(
      tx,
      'SELECT digest FROM platform_migrations WHERE version=1',
    );
    if (old) {
      if (old.digest !== hash)
        throw new Error('Platform migration history mismatch');
      return;
    }
    await tx.query(sql);
    await tx.query('INSERT INTO platform_migrations VALUES(1,$1)', [hash]);
  });
}
export async function audit(
  tx: Tx,
  actor: string | null,
  action: string,
  organization: string | null = null,
  target: string | null = null,
  metadata: object = {},
) {
  await tx.query(
    'INSERT INTO platform_audit(actor_id,action,organization_id,target_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, action, organization, target, metadata],
  );
}
