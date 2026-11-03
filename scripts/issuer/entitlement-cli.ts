import { parseArgs } from 'node:util';
import { loadIssuerKey } from './entitlement.js';
import {
  issueRegisteredEntitlement,
  writeGrantOutput,
  assertGrantOutputPath,
} from './register.js';
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
      register: { type: 'string' },
      'register-id': { type: 'string' },
    },
  });
  if (
    !values.claims ||
    !values['key-file'] ||
    !values['key-id'] ||
    !values.trust ||
    !values.output ||
    !values.register ||
    !values['register-id'] ||
    Boolean(values['previous-grant']) === Boolean(values['new-organization']) ||
    !process.env.ISSUER_KEY_PASSPHRASE
  )
    throw new Error();
  assertGrantOutputPath(values.register, values.output);
  passphrase = Buffer.from(process.env.ISSUER_KEY_PASSPHRASE, 'utf8');
  delete process.env.ISSUER_KEY_PASSPHRASE;
  pem = await readBounded(values['key-file'], 16384);
  const envelope = await issueRegisteredEntitlement({
    directory: values.register,
    registerId: values['register-id'],
    newOrganization: Boolean(values['new-organization']),
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
  await writeGrantOutput(values.output, envelope);
  process.stdout.write('{"event":"entitlement_issued"}\n');
} catch {
  process.stderr.write(
    '{"event":"entitlement_issue_failed","message":"Check approved claims, encrypted key, public trust, protected passphrase and authoritative --register/--register-id. Select exactly one of --new-organization or --previous-grant. If issuance was recorded but output failed, export the committed grant to a new path; do not reset history."}\n',
  );
  process.exitCode = 1;
} finally {
  pem?.fill(0);
  passphrase?.fill(0);
  delete process.env.ISSUER_KEY_PASSPHRASE;
}
