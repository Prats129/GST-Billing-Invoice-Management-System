import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { stageReleasePackage } from './release-staging.js';

try {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      'staging-parent': { type: 'string' },
      trust: { type: 'string' },
      'installed-version': { type: 'string' },
      'schema-digest': { type: 'string' },
    },
  });
  if (
    !values.root ||
    !values['staging-parent'] ||
    !values.trust ||
    !values['installed-version'] ||
    !values['schema-digest'] ||
    (await stat(values.trust)).size > 32768
  )
    throw new Error();
  const trust = loadEntitlementTrust(
    JSON.parse(await readFile(values.trust, 'utf8')),
  );
  const result = await stageReleasePackage(
    values.root,
    values['staging-parent'],
    trust,
    {
      version: values['installed-version'],
      schemaDigest: values['schema-digest'],
    },
  );
  process.stdout.write(
    JSON.stringify({ event: 'release_staged', ...result }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"release_staging_failed","message":"Do not install. Check approved public keys, installed version/schema, package integrity, private staging storage and ancestor permissions."}\n',
  );
  process.exitCode = 1;
}
