import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { provisionRecoveryRuntime } from './runtime-access.js';

config({
  path:
    process.env.ENV_FILE ??
    fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});
try {
  const { values } = parseArgs({
    options: {
      database: { type: 'string' },
      'confirm-database': { type: 'string' },
      'installation-id': { type: 'string' },
      role: { type: 'string' },
    },
  });
  if (
    !process.env.MIGRATION_DATABASE_URL ||
    !values.database ||
    !values['confirm-database'] ||
    !values['installation-id'] ||
    !values.role
  )
    throw new Error();
  const result = await provisionRecoveryRuntime({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    database: values.database,
    confirmDatabase: values['confirm-database'],
    installationId: values['installation-id'],
    runtimeRole: values.role,
  });
  process.stdout.write(
    JSON.stringify({
      event: 'recovery_runtime_access_provisioned',
      ...result,
    }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"recovery_runtime_access_failed","message":"Check the quarantined candidate, matching confirmations, dedicated unprivileged role, schema and existing privileges. No role credentials or service configuration are changed. Verify quarantine after a host/database outage."}\n',
  );
  process.exitCode = 1;
}
