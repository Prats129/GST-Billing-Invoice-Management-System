import { migrationDigest } from './backup-operator.js';

try {
  if (process.argv.length !== 2) throw new Error();
  // Expected schema from this release's files, not a claim about a live database.
  process.stdout.write(
    JSON.stringify({
      event: 'release_schema',
      schemaDigest: await migrationDigest(),
    }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"release_schema_failed","message":"Run without arguments from a complete trusted release containing its migration files."}\n',
  );
  process.exitCode = 1;
}
