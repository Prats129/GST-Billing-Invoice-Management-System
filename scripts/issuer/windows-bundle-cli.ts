import { parseArgs } from 'node:util';
import {
  assembleWindowsBundle,
  sealWindowsBundle,
  verifyWindowsBundle,
} from './windows-bundle.js';
import { smokeWindowsBundle } from './windows-bundle-smoke.js';
import { readBounded } from './inputs.js';
import { loadIssuerKey } from './entitlement.js';
let pem: Buffer | undefined, passphrase: Buffer | undefined;
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      configuration: { type: 'string' },
      root: { type: 'string' },
      trust: { type: 'string' },
      metadata: { type: 'string' },
      'key-file': { type: 'string' },
      'key-id': { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new Error();
  const action = positionals[0];
  let result: unknown;
  const json = async (path: string, max = 32768) =>
    JSON.parse((await readBounded(path, max)).toString('utf8')) as unknown;
  if (action === 'prepare') {
    if (
      !values.configuration ||
      values.root ||
      values.trust ||
      values.metadata ||
      values['key-file'] ||
      values['key-id']
    )
      throw new Error();
    result = await assembleWindowsBundle(await json(values.configuration));
  } else if (action === 'seal') {
    if (
      !values.root ||
      !values.metadata ||
      !values.trust ||
      !values['key-file'] ||
      !values['key-id'] ||
      !process.env.ISSUER_KEY_PASSPHRASE ||
      values.configuration
    )
      throw new Error();
    passphrase = Buffer.from(process.env.ISSUER_KEY_PASSPHRASE);
    delete process.env.ISSUER_KEY_PASSPHRASE;
    pem = await readBounded(values['key-file'], 16384);
    result = await sealWindowsBundle({
      root: values.root,
      metadata: await json(values.metadata),
      trust: await json(values.trust),
      keyId: values['key-id'],
      privateKey: loadIssuerKey(pem, passphrase),
    });
  } else if (action === 'verify') {
    if (
      !values.root ||
      !values.trust ||
      values.configuration ||
      values.metadata ||
      values['key-file'] ||
      values['key-id']
    )
      throw new Error();
    result = await verifyWindowsBundle(values.root, await json(values.trust));
  } else if (action === 'smoke') {
    if (
      !values.root ||
      values.trust ||
      values.configuration ||
      values.metadata ||
      values['key-file'] ||
      values['key-id']
    )
      throw new Error();
    result = await smokeWindowsBundle(
      values.root,
      process.env.BUNDLE_TEST_DATABASE_URL,
    );
  } else throw new Error();
  process.stdout.write(
    JSON.stringify({ event: 'windows_bundle_' + action, result }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"windows_bundle_failed","message":"Retain incomplete output. Check built production inputs, ordinary files, approved vendor pins/notices and external signing credentials. No services were installed."}\n',
  );
  process.exitCode = 1;
} finally {
  pem?.fill(0);
  passphrase?.fill(0);
  delete process.env.ISSUER_KEY_PASSPHRASE;
}
