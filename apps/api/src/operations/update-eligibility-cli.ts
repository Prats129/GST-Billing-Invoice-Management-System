import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createDatabase } from '@gst/database';
import { parseConfig } from '../config.js';
import { EntitlementsService } from '../licensing/entitlements.service.js';
import { checkOfflineUpdateEligibility } from './update-eligibility.js';

loadEnv({
  path:
    process.env.ENV_FILE ??
    fileURLToPath(new URL('../../../../.env', import.meta.url)),
  quiet: true,
});
let database: ReturnType<typeof createDatabase> | undefined;
try {
  if (process.argv.length !== 2 || !process.env.MIGRATION_DATABASE_URL)
    throw new Error();
  const config = parseConfig(process.env);
  const { trust } = new EntitlementsService(config);
  if (
    config.DEPLOYMENT_EDITION !== 'offline' ||
    !config.OFFLINE_INSTALLATION_ID ||
    !trust
  )
    throw new Error();
  // Operator connection must see all organizations, not a tenant-filtered subset.
  database = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const result = await checkOfflineUpdateEligibility(
    database,
    trust,
    config.OFFLINE_INSTALLATION_ID,
  );
  process.stdout.write(
    JSON.stringify({ event: 'offline_update_eligible', ...result }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"offline_update_ineligible","message":"Do not install. Check offline configuration, operator database access and current signed maintenance for every organization."}\n',
  );
  process.exitCode = 1;
} finally {
  await database?.close();
}
