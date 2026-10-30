import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createDatabase } from '@gst/database';
import { parseConfig } from '../config.js';
import { EntitlementsService } from './entitlements.service.js';
import { installEntitlement } from './install.js';

loadEnv({
  path:
    process.env.ENV_FILE ??
    fileURLToPath(new URL('../../../../.env', import.meta.url)),
  quiet: true,
});
let db: ReturnType<typeof createDatabase> | undefined;
try {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length || !process.env.MIGRATION_DATABASE_URL)
    throw new Error();
  const info = await stat(path);
  if (!info.isFile() || info.size > 16384) throw new Error();
  const config = parseConfig(process.env);
  const policy = new EntitlementsService(config);
  if (!policy.trust) throw new Error();
  db = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const result = await installEntitlement(
    db,
    config,
    policy.trust,
    JSON.parse(await readFile(path, 'utf8')),
  );
  process.stdout.write(
    JSON.stringify({ event: 'entitlement_installed', ...result }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"entitlement_install_failed","message":"Check the signed grant, trusted public keys, installation binding, sequence and private operator connection."}\n',
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
