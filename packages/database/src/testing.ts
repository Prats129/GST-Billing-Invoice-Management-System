import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createDatabase, migrateDatabase } from './index.js';

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
