import { parseArgs } from 'node:util';
import { readBounded } from './inputs.js';
import { loadIssuerKey } from './entitlement.js';
import { signReleasePackage } from './release.js';

let pem: Buffer | undefined;
let passphrase: Buffer | undefined;
try {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      metadata: { type: 'string' },
      'key-file': { type: 'string' },
      'key-id': { type: 'string' },
      trust: { type: 'string' },
    },
  });
  if (
    !values.root ||
    !values.metadata ||
    !values['key-file'] ||
    !values['key-id'] ||
    !values.trust ||
    !process.env.ISSUER_KEY_PASSPHRASE
  )
    throw new Error();
  passphrase = Buffer.from(process.env.ISSUER_KEY_PASSPHRASE, 'utf8');
  delete process.env.ISSUER_KEY_PASSPHRASE;
  pem = await readBounded(values['key-file'], 16384);
  const manifest = await signReleasePackage({
    root: values.root,
    metadata: JSON.parse(
      (await readBounded(values.metadata, 16384)).toString('utf8'),
    ),
    keyId: values['key-id'],
    privateKey: loadIssuerKey(pem, passphrase),
    trust: JSON.parse(
      (await readBounded(values.trust, 32768)).toString('utf8'),
    ),
  });
  process.stdout.write(
    JSON.stringify({
      event: 'release_signed',
      version: manifest.version,
      files: manifest.files.length,
    }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"release_signing_failed","message":"Do not publish. Check protected staging, approved release metadata, encrypted signing key, public trust and ISSUER_KEY_PASSPHRASE. Quarantine an incomplete staging directory."}\n',
  );
  process.exitCode = 1;
} finally {
  pem?.fill(0);
  passphrase?.fill(0);
  delete process.env.ISSUER_KEY_PASSPHRASE;
}
