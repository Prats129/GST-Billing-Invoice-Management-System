import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupError } from './backup-artifact.js';
import {
  createEncryptedBackup,
  prepareRecovery,
  verifyRestore,
} from './backup-operator.js';

config({
  path:
    process.env.ENV_FILE ??
    fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'key-file': { type: 'string' },
      'installation-id': { type: 'string' },
      'work-directory': { type: 'string' },
      artifact: { type: 'string' },
      'pg-bin-directory': { type: 'string' },
      'docker-container': { type: 'string' },
      'confirm-installation-id': { type: 'string' },
      'upgrade-to-schema': { type: 'string' },
    },
  });
  const action = positionals[0];
  if (
    positionals.length !== 1 ||
    !['keygen', 'create', 'verify', 'prepare-recovery'].includes(action ?? '')
  )
    throw new BackupError(
      'Usage: backup <keygen|create|verify|prepare-recovery> --key-file <private-file> [--installation-id <uuid> --work-directory <private-directory> --artifact <path> --pg-bin-directory <directory> | --docker-container <local-container>]. Recovery preparation also requires --confirm-installation-id <same-uuid>.',
    );
  if (
    (action === 'prepare-recovery' &&
      (!values['confirm-installation-id'] ||
        values['confirm-installation-id'] !== values['installation-id'])) ||
    (action !== 'prepare-recovery' && values['confirm-installation-id'])
  )
    throw new BackupError(
      'Recovery requires the matching --confirm-installation-id; that option is not accepted by other backup commands.',
    );
  if (
    values['upgrade-to-schema'] !== undefined &&
    (action !== 'prepare-recovery' ||
      !/^[a-f0-9]{64}$/.test(values['upgrade-to-schema']))
  )
    throw new BackupError(
      '--upgrade-to-schema is accepted only for recovery preparation and must be a reviewed SHA-256 release schema digest.',
    );
  if (!values['key-file'])
    throw new BackupError(
      'Specify --key-file in a protected private directory.',
    );
  const keyFile = resolve(values['key-file']);
  if (action === 'keygen') {
    // Parent ACLs must be provisioned by the host operator; no secrets are
    // printed, and an existing key is never replaced.
    if (process.platform === 'win32')
      throw new BackupError(
        'On Windows, create the key with New-BackupKey.ps1, which secures NTFS ACLs before writing.',
      );
    await writeFile(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
    process.stdout.write(
      JSON.stringify({
        event: 'backup_key_created',
        installationId: randomUUID(),
      }) + '\n',
    );
  } else {
    if (
      !values['installation-id'] ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        values['installation-id'],
      )
    )
      throw new BackupError(
        'Supply the persistent host --installation-id UUID; do not generate a new identity for each backup.',
      );
    if (
      !values['work-directory'] ||
      !values.artifact ||
      !process.env.MIGRATION_DATABASE_URL
    )
      throw new BackupError(
        'Supply --work-directory, --artifact and the private MIGRATION_DATABASE_URL.',
      );
    const options = {
      connectionString: process.env.MIGRATION_DATABASE_URL,
      installationId: values['installation-id'],
      key: await readFile(keyFile),
      workDirectory: resolve(values['work-directory']),
      ...(values['pg-bin-directory']
        ? { pgBinDirectory: resolve(values['pg-bin-directory']) }
        : {}),
      ...(values['docker-container']
        ? { dockerContainer: values['docker-container'] }
        : {}),
    };
    if (Boolean(options.pgBinDirectory) === Boolean(options.dockerContainer))
      throw new BackupError(
        'Select exactly one tool source: pg-bin-directory or docker-container.',
      );
    const result =
      action === 'create'
        ? await createEncryptedBackup(options, resolve(values.artifact))
        : action === 'prepare-recovery'
          ? await prepareRecovery(
              options,
              resolve(values.artifact),
              values['confirm-installation-id']!,
              values['upgrade-to-schema'],
            )
          : await verifyRestore(options, resolve(values.artifact));
    process.stdout.write(
      JSON.stringify({
        event:
          action === 'create'
            ? 'backup_created'
            : action === 'prepare-recovery'
              ? 'recovery_prepared'
              : 'backup_restore_verified',
        result,
      }) + '\n',
    );
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      event: 'backup_failed',
      message:
        error instanceof BackupError
          ? error.message
          : 'Backup operation failed. Check private paths, access, disk space and configuration.',
    }) + '\n',
  );
  process.exitCode = 1;
}
