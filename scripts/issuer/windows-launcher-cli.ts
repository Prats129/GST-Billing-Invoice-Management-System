import { parseArgs } from 'node:util';
import { buildWindowsLauncher } from './windows-launcher.js';
import { readBounded } from './inputs.js';
try {
  const { values } = parseArgs({
    options: {
      bundle: { type: 'string' },
      trust: { type: 'string' },
      output: { type: 'string' },
      certificate: { type: 'string' },
    },
  });
  if (!values.bundle || !values.trust || !values.output) throw new Error();
  const report = await buildWindowsLauncher({
    bundle: values.bundle,
    output: values.output,
    trust: JSON.parse(
      (await readBounded(values.trust, 32768)).toString('utf8'),
    ),
    ...(values.certificate ? { publisherCertificate: values.certificate } : {}),
  });
  process.stdout.write(JSON.stringify(report) + '\n');
} catch {
  process.stderr.write(
    'Maintenance launcher build failed. Use an intact sealed Windows bundle, approved public trust, and a new protected output directory. Retain partial output for inspection.\n',
  );
  process.exitCode = 1;
}
