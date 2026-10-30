import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { verifyReleasePackage } from './release-package.js';

try {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      trust: { type: 'string' },
      'installed-version': { type: 'string' },
      'schema-digest': { type: 'string' },
    },
  });
  if (
    !values.root ||
    !values.trust ||
    !values['installed-version'] ||
    !values['schema-digest'] ||
    (await stat(values.trust)).size > 32768
  )
    throw Error();
  const trust = loadEntitlementTrust(
    JSON.parse(await readFile(values.trust, 'utf8')),
  );
  const manifest = await verifyReleasePackage(values.root, trust, {
    version: values['installed-version'],
    schemaDigest: values['schema-digest'],
  });
  process.stdout.write(
    JSON.stringify({
      event: 'release_verified',
      version: manifest.version,
      files: manifest.files.length,
      schemaDigest: manifest.toSchemaDigest,
    }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"release_verification_failed","message":"Do not install this package. Check the approved release keys, file integrity and installed version/schema."}\n',
  );
  process.exitCode = 1;
}
