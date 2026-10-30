import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { issueEntitlement, loadIssuerKey } from './entitlement.js';
import { readBounded } from './inputs.js';

let pem: Buffer | undefined;
let passphrase: Buffer | undefined;
try {
  const { values } = parseArgs({
    options: {
      claims: { type: 'string' },
      'key-file': { type: 'string' },
      'key-id': { type: 'string' },
      trust: { type: 'string' },
      output: { type: 'string' },
      'previous-grant': { type: 'string' },
      'new-organization': { type: 'boolean' },
    },
  });
  if (
    !values.claims ||
    !values['key-file'] ||
    !values['key-id'] ||
    !values.trust ||
    !values.output ||
    Boolean(values['previous-grant']) === Boolean(values['new-organization']) ||
    !process.env.ISSUER_KEY_PASSPHRASE
  )
    throw new Error();
  passphrase = Buffer.from(process.env.ISSUER_KEY_PASSPHRASE, 'utf8');
  delete process.env.ISSUER_KEY_PASSPHRASE;
  pem = await readBounded(values['key-file'], 16384);
  const envelope = issueEntitlement({
    claims: JSON.parse(
      (await readBounded(values.claims, 16384)).toString('utf8'),
    ),
    keyId: values['key-id'],
    privateKey: loadIssuerKey(pem, passphrase),
    trust: JSON.parse(
      (await readBounded(values.trust, 32768)).toString('utf8'),
    ),
    ...(values['previous-grant']
      ? {
          previousGrant: JSON.parse(
            (await readBounded(values['previous-grant'], 16384)).toString(
              'utf8',
            ),
          ),
        }
      : {}),
  });
  await writeFile(values.output, JSON.stringify(envelope) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write('{"event":"entitlement_issued"}\n');
} catch {
  process.stderr.write(
    '{"event":"entitlement_issue_failed","message":"Use approved claims, encrypted Ed25519 key, matching public trust, protected ISSUER_KEY_PASSPHRASE and a new output path. Select exactly one of --new-organization or --previous-grant."}\n',
  );
  process.exitCode = 1;
} finally {
  pem?.fill(0);
  passphrase?.fill(0);
  delete process.env.ISSUER_KEY_PASSPHRASE;
}
