import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createDatabase, migrateDatabase, organizations } from './index.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for integration tests (dedicated local/CI cluster only)',
  );
const databaseName = `gst_test_${randomUUID().replaceAll('-', '')}`;
const connectionUrl = new URL(adminUrl);
connectionUrl.pathname = `/${databaseName}`;
const admin = new Client({
  connectionString: adminUrl,
  connectionTimeoutMillis: 5000,
});
let database: ReturnType<typeof createDatabase> | undefined;
let created = false;
beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await migrateDatabase(connectionUrl.toString());
  await migrateDatabase(connectionUrl.toString());
  database = createDatabase(connectionUrl.toString());
});
afterAll(async () => {
  try {
    await database?.close();
  } finally {
    try {
      if (created)
        await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
});

test('clean migration is repeatable, schema ready, and organizations persist', async () => {
  await database!.ready();
  const [row] = await database!.db
    .insert(organizations)
    .values({ name: 'Foundation smoke', status: 'suspended' })
    .returning();
  expect(row).toMatchObject({ name: 'Foundation smoke', status: 'suspended' });
  expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
});
test('database rejects invalid organization states and blank names', async () => {
  await expect(
    database!.db
      .insert(organizations)
      .values({ name: 'Invalid', status: 'unknown' }),
  ).rejects.toThrow();
  await expect(
    database!.db.insert(organizations).values({ name: '   ' }),
  ).rejects.toThrow();
});
test('transaction rolls back organization creation', async () => {
  const name = `rollback-${randomUUID()}`;
  await expect(
    database!.db.transaction(async (tx) => {
      await tx.insert(organizations).values({ name });
      throw new Error('intentional rollback');
    }),
  ).rejects.toThrow('intentional rollback');
  const rows = await database!.db.query.organizations.findMany();
  expect(rows.some((row) => row.name === name)).toBe(false);
});
