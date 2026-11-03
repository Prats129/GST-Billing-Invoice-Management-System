import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { verifyRetainedDatabase } from './verify-retained.js';
try {
  const [root, schemaDigest, ...extra] = process.argv.slice(2);
  if (!root || !schemaDigest || extra.length) throw new Error();
  const read = async (file: string) => {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32768)
      throw new Error();
    const bytes = await readFile(file);
    if (bytes.length > 32768) throw new Error();
    return bytes.toString('utf8');
  };
  const input = JSON.parse(
    await read(join(root, 'operator', 'database-input.json')),
  );
  const receipt = JSON.parse(
    await read(join(root, 'operator', 'database-receipt.json')),
  );
  const operator = parse(await read(join(root, 'operator', 'operator.env'))),
    runtime = parse(await read(join(root, 'runtime', 'runtime.env')));
  if (
    receipt.database !== 'gst_billing' ||
    input.expectedDataDirectory !== join(root, 'data') ||
    runtime.OFFLINE_INSTALLATION_ID !== input.installationId ||
    operator.OFFLINE_INSTALLATION_ID !== input.installationId ||
    !runtime.DATABASE_URL ||
    !operator.MIGRATION_DATABASE_URL
  )
    throw new Error();
  await verifyRetainedDatabase({
    adminConnectionString: input.adminConnectionString,
    ownerConnectionString: operator.MIGRATION_DATABASE_URL,
    runtimeConnectionString: runtime.DATABASE_URL,
    expectedDataDirectory: input.expectedDataDirectory,
    systemIdentifier: receipt.systemIdentifier,
    schemaDigest,
  });
  process.stdout.write('{"ok":true}\n');
} catch {
  process.stderr.write('{"event":"retained_database_verification_failed"}\n');
  process.exitCode = 1;
}
