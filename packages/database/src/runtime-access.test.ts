import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { provisionRecoveryRuntime } from './runtime-access.js';

test('runtime provisioning rejects unsafe targets and missing confirmations before a connection', async () => {
  const database = 'gst_recovery_' + randomUUID().replaceAll('-', '');
  const options = {
    connectionString: 'not-a-database',
    database,
    confirmDatabase: database,
    installationId: randomUUID(),
    runtimeRole: 'gst_runtime',
  };
  for (const change of [
    { database: 'billing' },
    { confirmDatabase: 'wrong' },
    { runtimeRole: 'runtime"; DROP ROLE postgres;' },
    { installationId: '-'.repeat(36) },
  ])
    await expect(
      provisionRecoveryRuntime({ ...options, ...change }),
    ).rejects.toThrow('Runtime access provisioning failed');
});
test('runtime provisioning cannot target the configured active database or nonlocal/uncontrolled URLs', async () => {
  const database = 'gst_recovery_' + randomUUID().replaceAll('-', '');
  const options = {
    database,
    confirmDatabase: database,
    installationId: randomUUID(),
    runtimeRole: 'gst_runtime',
  };
  for (const connectionString of [
    'not-a-url',
    `postgres://fixture:fixture@127.0.0.1/${database}`,
    'postgres://fixture:fixture@example.test/source',
    'postgres://fixture:fixture@127.0.0.1/source?options=uncontrolled',
  ])
    await expect(
      provisionRecoveryRuntime({ ...options, connectionString }),
    ).rejects.toThrow('Runtime access provisioning failed');
});
