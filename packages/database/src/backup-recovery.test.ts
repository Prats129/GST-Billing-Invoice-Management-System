import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prepareRecovery } from './backup-operator.js';

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
