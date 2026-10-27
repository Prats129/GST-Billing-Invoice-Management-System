import type { LoggerService } from '@nestjs/common';

// Deliberately discard framework payloads: errors may contain credentials or SQL.
export const safeLogger: LoggerService = {
  log: () => {},
  warn: () => {
    process.stdout.write(
      JSON.stringify({ level: 'warn', event: 'framework_warning' }) + '\n',
    );
  },
  error: () => {
    process.stderr.write(
      JSON.stringify({ level: 'error', event: 'framework_error' }) + '\n',
    );
  },
};
export function logEvent(
  event: string,
  fields: Record<string, string | number> = {},
): void {
  process.stdout.write(
    JSON.stringify({ level: 'info', event, ...fields }) + '\n',
  );
}
