import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { config } from './config.js';
import { createPlatformApp } from './app.js';
loadEnv({
  path:
    process.env.PLATFORM_ENV_FILE ??
    fileURLToPath(new URL('../../../.env.admin', import.meta.url)),
  quiet: true,
});
try {
  const c = config(process.env);
  if (
    c.NODE_ENV === 'production' &&
    (process.env.PLATFORM_MIGRATION_DATABASE_URL ||
      process.env.SAAS_MIGRATION_DATABASE_URL)
  )
    throw new Error('Privileged credentials are prohibited in runtime.');
  const { app, services } = await createPlatformApp(c);
  await app.listen(c.PLATFORM_PORT, c.PLATFORM_HOST);
  services.operations.start();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void app.close().then(() => process.exit(0)));
  process.stdout.write('{"event":"platform_started"}\n');
} catch {
  process.stderr.write(
    '{"event":"platform_startup_failed","message":"Check platform configuration, database migrations and TLS"}\n',
  );
  process.exitCode = 1;
}
