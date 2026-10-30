import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrationDigest, prepareRecovery } from './backup-operator.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

test('recovery confirmation is required before touching tools, files or a database', async () => {
  const options = {
    connectionString: 'not-a-database-url',
    installationId: randomUUID(),
    key: Buffer.alloc(32),
    workDirectory: 'must-not-be-created',
  };
  for (const confirmation of ['', randomUUID()])
    await expect(
      prepareRecovery(options, 'missing-artifact', confirmation),
    ).rejects.toThrow('Confirm the persistent installation UUID');
});

test('upgrade confirmation rejects malformed or unrelated digests before opening a database or tools', async () => {
  const installationId = randomUUID();
  const options = {
    connectionString: 'not-a-database-url',
    installationId,
    key: Buffer.alloc(32),
    workDirectory: 'must-not-be-created',
  };
  for (const target of ['', 'not-a-hash', 'ab'.repeat(32)])
    await expect(
      prepareRecovery(options, 'missing-artifact', installationId, target),
    ).rejects.toThrow('exact current release schema digest');
});

test('the schema CLI reads release files without database credentials and rejects unexpected arguments', async () => {
  const run = (...args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve('packages/database/src/schema-cli.ts'),
        ...args,
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: 'not-a-database',
          MIGRATION_DATABASE_URL: 'not-a-database',
        },
        timeout: 15000,
      },
    );
  const { stdout, stderr } = await run();
  expect(JSON.parse(stdout)).toEqual({
    event: 'release_schema',
    schemaDigest: await migrationDigest(),
  });
  expect(stderr).toBe('');
  await expect(run('--unexpected')).rejects.toMatchObject({
    code: 1,
    stdout: '',
  });
}, 30000);

test('recovery rejects ambiguous or absent PostgreSQL tool sources before starting tools', async () => {
  const installationId = randomUUID();
  const options = {
    connectionString: 'not-a-database-url',
    installationId,
    key: Buffer.alloc(32),
    workDirectory: 'must-not-be-created',
  };
  await expect(
    prepareRecovery(options, 'missing-artifact', installationId),
  ).rejects.toThrow('Select exactly one');
  await expect(
    prepareRecovery(
      {
        ...options,
        pgBinDirectory: 'missing-tools',
        dockerContainer: 'missing-container',
      },
      'missing-artifact',
      installationId,
    ),
  ).rejects.toThrow('Select exactly one');
});
