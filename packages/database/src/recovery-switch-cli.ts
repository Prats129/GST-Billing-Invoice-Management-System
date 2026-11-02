import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { recoverySwitchStatus, switchRecovery } from './recovery-switch.js';

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
      'recovery-database': { type: 'string' },
      'confirm-active-database': { type: 'string' },
      'installation-id': { type: 'string' },
      'confirm-writers-stopped': { type: 'boolean', default: false },
      'confirm-rollback-data-loss': { type: 'boolean', default: false },
    },
  });
  const action = positionals[0];
  if (
    positionals.length !== 1 ||
    !['activate', 'rollback', 'status'].includes(action ?? '') ||
    !process.env.MIGRATION_DATABASE_URL ||
    !process.env.DATABASE_URL ||
    !values['recovery-database'] ||
    !values['confirm-active-database'] ||
    !values['installation-id']
  )
    throw new Error();
  const options = {
    connectionString: process.env.MIGRATION_DATABASE_URL,
    runtimeConnectionString: process.env.DATABASE_URL,
    recoveryDatabase: values['recovery-database'],
    confirmActiveDatabase: values['confirm-active-database'],
    installationId: values['installation-id'],
    confirmWritersStopped: values['confirm-writers-stopped'],
    confirmRollbackDataLoss: values['confirm-rollback-data-loss'],
  };
  const result =
    action === 'status'
      ? await recoverySwitchStatus(options)
      : await switchRecovery(options, action as 'activate' | 'rollback');
  process.stdout.write(
    JSON.stringify({ event: 'recovery_switch_' + action, ...result }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"recovery_switch_failed","message":"Keep the application stopped. Check confirmations, local operator/runtime credentials, recovery identity/schema/permissions and connected clients. Inspect status before retrying after a host/database outage or lost commit acknowledgement."}\n',
  );
  process.exitCode = 1;
}
