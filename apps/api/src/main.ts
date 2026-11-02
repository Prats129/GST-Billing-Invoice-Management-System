import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createApp } from './app.js';
import { parseConfig } from './config.js';
import { logEvent } from './logging.js';
import { TlsConfigurationError } from './tls.js';

loadEnv({
  path:
    process.env.ENV_FILE ??
    fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});
try {
  const config = parseConfig(process.env);
  const app = await createApp(config);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
  await app.listen(config.PORT, config.HOST);
  logEvent('api_started', {
    port: config.PORT,
    edition: config.DEPLOYMENT_EDITION,
  });
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      event: 'startup_failed',
      message: 'Check environment, TLS paths and port availability',
      ...(error instanceof TlsConfigurationError ? { code: error.code } : {}),
    }) + '\n',
  );
  process.exitCode = 1;
}
