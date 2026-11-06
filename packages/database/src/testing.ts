import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createDatabase, migrateDatabase } from './index.js';
import { sql } from 'drizzle-orm';

// Fixture-only rollback of known additive migrations. Never exported by runtime.
// This builds the genuine historical schema, not just a shortened journal.
export async function setTestDatabaseToPhase5(
  database: ReturnType<typeof createDatabase>,
) {
  await database.db.transaction(async (tx) => {
    const result = await tx.execute(sql`SELECT current_database() AS name`);
    if (!/^gst_test_[a-f0-9]{32}$/.test(String(result.rows[0]?.name)))
      throw new Error('Disposable fixture required');
    await tx.execute(sql`DROP SCHEMA IF EXISTS platform_operator CASCADE`);
    await tx.execute(sql`DROP TABLE IF EXISTS public.trusted_devices`);
    await tx.execute(
      sql`DROP TABLE IF EXISTS public.owner_setup_tokens,public.organization_write_controls`,
    );
    await tx.execute(
      sql`ALTER TABLE public.users DROP COLUMN IF EXISTS theme_mode,DROP COLUMN IF EXISTS theme_accent`,
    );
    await tx.execute(sql`DROP TABLE public.organization_entitlements`);
    await tx.execute(
      sql`DELETE FROM drizzle.__drizzle_migrations WHERE id NOT IN (SELECT id FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 5)`,
    );
  });
}

// Explicit test-only entry point. Never accepts a caller-selected drop target.
export async function createIsolatedTestDatabase(adminUrl: string) {
  const name = `gst_test_${randomUUID().replaceAll('-', '')}`;
  const connection = new URL(adminUrl);
  connection.pathname = `/${name}`;
  const admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  let created = false;
  let database: ReturnType<typeof createDatabase> | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await migrateDatabase(connection.toString());
    database = createDatabase(connection.toString());
  } catch (error) {
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    throw error;
  }
  const instance = database;
  return {
    database: instance,
    connectionString: connection.toString(),
    async cleanup() {
      try {
        await instance.close();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}
