import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { migrateDatabase } from './migrate.js';

config({
  path:
    process.env.ENV_FILE ??
    fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});
const connection = process.env.MIGRATION_DATABASE_URL;
if (!connection) {
  process.stderr.write(
    'MIGRATION_DATABASE_URL is required; migrations never use application credentials implicitly.\n',
  );
  process.exitCode = 1;
} else {
  try {
    await migrateDatabase(connection);
    process.stdout.write('Reviewed migrations applied.\n');
  } catch {
    process.stderr.write(
      'Migration failed. Check connectivity, privileges and reviewed migration history; no automatic rollback attempted.\n',
    );
    process.exitCode = 1;
  }
}
