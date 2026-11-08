import { parseArgs } from 'node:util';
import { loadIssuerKey } from './entitlement.js';
import {
  issueRegisteredEntitlement,
  writeGrantOutput,
  assertGrantOutputPath,
} from './register.js';
import { readBounded } from './inputs.js';
import { licenseHandoffSchema } from '../../packages/contracts/dist/index.js';

let pem: Buffer | undefined;
let passphrase: Buffer | undefined;
try {
  const { values } = parseArgs({
    options: {
      claims: { type: 'string' },
      request: { type: 'string' },
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
    Boolean(values.claims) === Boolean(values.request) ||
    !values['key-file'] ||
    !values['key-id'] ||
    !values.trust ||
    !values.output ||
    !values.register ||
    !values['register-id'] ||
    (values.request
      ? Boolean(values['previous-grant'] || values['new-organization'])
      : Boolean(values['previous-grant']) ===
        Boolean(values['new-organization'])) ||
    !process.env.ISSUER_KEY_PASSPHRASE
  )
    throw new Error();
  const handoff = values.request
    ? licenseHandoffSchema.parse(
        JSON.parse((await readBounded(values.request, 32768)).toString('utf8')),
      )
    : undefined;
  assertGrantOutputPath(values.register, values.output);
  passphrase = Buffer.from(process.env.ISSUER_KEY_PASSPHRASE, 'utf8');
  delete process.env.ISSUER_KEY_PASSPHRASE;
  pem = await readBounded(values['key-file'], 16384);
  const envelope = await issueRegisteredEntitlement({
    directory: values.register,
    registerId: values['register-id'],
    newOrganization: handoff
      ? handoff.predecessor === null
      : Boolean(values['new-organization']),
    claims:
      handoff?.claims ??
      JSON.parse((await readBounded(values.claims!, 16384)).toString('utf8')),
    keyId: values['key-id'],
    privateKey: loadIssuerKey(pem, passphrase),
    trust: JSON.parse(
      (await readBounded(values.trust, 32768)).toString('utf8'),
    ),
    ...(handoff?.predecessor
      ? { previousGrant: handoff.predecessor }
      : values['previous-grant']
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
    '{"event":"entitlement_issue_failed","message":"Check the approved --request handoff OR --claims with exactly one of --new-organization/--previous-grant, encrypted key, public trust, protected passphrase and authoritative --register/--register-id. If issuance was recorded but output failed, export the committed grant to a new path; do not reset history."}\n',
  );
  process.exitCode = 1;
} finally {
  pem?.fill(0);
  passphrase?.fill(0);
  delete process.env.ISSUER_KEY_PASSPHRASE;
}
