import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { switchRecovery } from './recovery-switch.js';

test('switch requires an exact active name, a generated recovery name and stopped writers', async () => {
  const options = {
    connectionString: 'postgres://operator:fixture@127.0.0.1/source',
    runtimeConnectionString: 'postgres://runtime:fixture@127.0.0.1/source',
    recoveryDatabase: 'gst_recovery_' + randomUUID().replaceAll('-', ''),
    confirmActiveDatabase: 'source',
    installationId: randomUUID(),
    confirmWritersStopped: true,
  };
  for (const change of [
    { confirmActiveDatabase: 'other' },
    { confirmWritersStopped: false },
    { recoveryDatabase: 'source' },
    { installationId: 'wrong' },
    { connectionString: 'postgres://operator:fixture@example.test/source' },
    {
      connectionString:
        'postgres://operator:fixture@127.0.0.1/source?options=unsafe',
    },
    {
      connectionString: 'postgres://operator:fixture@127.0.0.1/postgres',
      confirmActiveDatabase: 'postgres',
    },
    { runtimeConnectionString: 'postgres://runtime:fixture@127.0.0.1/other' },
    {
      runtimeConnectionString:
        'postgres://runtime:fixture@127.0.0.1:5433/source',
    },
    {
      runtimeConnectionString: 'postgres://runtime:fixture@example.test/source',
    },
  ])
    await expect(
      switchRecovery({ ...options, ...change }, 'activate'),
    ).rejects.toThrow('Recovery switch failed');
});

test('rollback requires explicit acknowledgement of reverting recovered changes', async () => {
  await expect(
    switchRecovery(
      {
        connectionString: 'postgres://operator:fixture@127.0.0.1/source',
        runtimeConnectionString: 'postgres://runtime:fixture@127.0.0.1/source',
        recoveryDatabase: 'gst_recovery_' + randomUUID().replaceAll('-', ''),
        confirmActiveDatabase: 'source',
        installationId: randomUUID(),
        confirmWritersStopped: true,
      },
      'rollback',
    ),
  ).rejects.toThrow('Recovery switch failed');
});
