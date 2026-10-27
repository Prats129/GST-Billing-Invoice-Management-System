import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export async function migrateDatabase(connectionString: string): Promise<void> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    application_name: 'gst-migrator',
  });
  await client.connect();
  try {
    // Serialize controlled migration invocations; bounded wait avoids hanging releases.
    await client.query("SET lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_lock(73492601)');
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(
        new URL('../migrations', import.meta.url),
      ),
    });
  } finally {
    // Session advisory lock is released even if a migration fails.
    await client.end();
  }
}
