import { parseArgs } from 'node:util';
import {
  initializeIssuanceRegister,
  exportRegisteredEntitlement,
  writeGrantOutput,
  assertGrantOutputPath,
} from './register.js';
import { readBounded } from './inputs.js';

// Register administration/export never needs the signing passphrase, including
// in the read-only ACL helper's child environment.
delete process.env.ISSUER_KEY_PASSPHRASE;

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      register: { type: 'string' },
      'register-id': { type: 'string' },
      organization: { type: 'string' },
      sequence: { type: 'string' },
      trust: { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (positionals.length !== 1 || !values.register) throw new Error();
  if (positionals[0] === 'init') {
    if (Object.keys(values).some((key) => key !== 'register'))
      throw new Error();
    const result = await initializeIssuanceRegister(values.register);
    process.stdout.write(
      JSON.stringify({ event: 'issuance_register_initialized', ...result }) +
        '\n',
    );
  } else if (positionals[0] === 'export') {
    if (
      !values['register-id'] ||
      !values.organization ||
      !values.sequence ||
      !/^[1-9][0-9]{0,9}$/.test(values.sequence) ||
      !values.trust ||
      !values.output
    )
      throw new Error();
    assertGrantOutputPath(values.register, values.output);
    const grant = await exportRegisteredEntitlement({
      directory: values.register,
      registerId: values['register-id'],
      organizationId: values.organization,
      sequence: Number(values.sequence),
      trust: JSON.parse(
        (await readBounded(values.trust, 32768)).toString('utf8'),
      ),
    });
    await writeGrantOutput(values.output, grant);
    process.stdout.write('{"event":"registered_entitlement_exported"}\n');
  } else throw new Error();
} catch {
  process.stderr.write(
    '{"event":"issuance_register_failed","message":"Use init with a new absolute protected register directory, or export with the expected register UUID, organization, committed sequence, approved public trust and a new output path. Never reset, copy for parallel issuance or delete register history."}\n',
  );
  process.exitCode = 1;
}
