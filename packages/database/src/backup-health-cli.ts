import { parseArgs } from 'node:util';
import { checkBackupHealth } from './backup-health.js';

try {
  const { values } = parseArgs({
    options: {
      directory: { type: 'string' },
      'maximum-age-hours': { type: 'string' },
    },
  });
  if (!values.directory || !values['maximum-age-hours']) throw new Error();
  const result = await checkBackupHealth(
    values.directory,
    Number(values['maximum-age-hours']),
  );
  process.stdout.write(
    JSON.stringify({ event: 'backup_health', ...result }) + '\n',
  );
  process.exitCode = result.healthy ? 0 : 1;
} catch {
  process.stderr.write(
    '{"event":"backup_health_failed","message":"Supply --directory and --maximum-age-hours (greater than zero, at most 8760)."}\n',
  );
  process.exitCode = 1;
}
