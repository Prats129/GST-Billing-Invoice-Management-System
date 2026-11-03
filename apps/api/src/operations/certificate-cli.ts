// Host operator command for an existing dedicated installation. No environment
// file is auto-loaded and no tenant HTTP endpoint is supplied.
import { parseArgs } from 'node:util';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { z } from 'zod';
import { parse } from 'dotenv';
import {
  certificateOptionsSchema,
  replaceCertificate,
  inspectCertificateReplacement,
  recoverCertificateReplacement,
  readCertificateOperationFile,
} from './certificate-replacement.js';
import {
  windowsCertificateServiceSchema,
  createWindowsCertificateService,
} from './windows-update-service.js';
import { assertPrivateDirectory } from './release-staging.js';
import { certificateHash } from './certificate-probe.js';
import { readInstallationState } from './installation-state.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const filePath = z.string().refine(isAbsolute);
const schema = z
  .object({
    format: z.literal(1),
    options: certificateOptionsSchema,
    windows: windowsCertificateServiceSchema,
    scripts: z
      .object({
        directory: filePath,
        hashes: z
          .object({
            'Invoke-UpdateService.ps1': hash,
            'UpdateService.ps1': hash,
            'Common.ps1': hash,
            'DeploymentChecks.ps1': hash,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      configuration: { type: 'string' },
      'source-key': { type: 'string' },
      'source-cert': { type: 'string' },
      'confirm-installation': { type: 'string' },
      maintenance: { type: 'boolean' },
      'operator-stopped': { type: 'boolean' },
      selection: { type: 'string' },
      'expected-key-sha256': { type: 'string' },
      'expected-cert-sha256': { type: 'string' },
    },
  });
  if (
    process.platform !== 'win32' ||
    positionals.length !== 1 ||
    !values.configuration ||
    !['replace', 'inspect', 'recover'].includes(positionals[0]!)
  )
    throw new Error();
  await assertPrivateDirectory(dirname(resolve(values.configuration)));
  const config = schema.parse(
    JSON.parse(
      (
        await readCertificateOperationFile(values.configuration, 65536)
      ).toString('utf8'),
    ),
  );
  const { options, windows } = config;
  const installed = await readInstallationState(options.journalParent);
  if (
    windows.operationId !== options.operationId ||
    windows.origin !== options.origin ||
    windows.journalDirectory !==
      join(options.journalParent, 'gst-update-' + options.operationId) ||
    windows.installedRoot !== installed.appRoot ||
    windows.certificateKeyPath !== options.keyPath ||
    windows.certificateCertPath !== options.certPath
  )
    throw new Error();
  const env = await readCertificateOperationFile(
    windows.environmentFile,
    32768,
  );
  if (certificateHash(env) !== windows.environmentSha256) throw new Error();
  const runtime = parse(env).DATABASE_URL;
  if (!runtime) throw new Error();
  const service = createWindowsCertificateService(windows, config.scripts, {
    runtimeConnectionString: runtime,
    installationId: options.installationId,
  });
  const confirmation = {
    installationId: values['confirm-installation'] ?? '',
    maintenance: values.maintenance === true,
  };
  let result: unknown;
  if (positionals[0] === 'inspect')
    result = await inspectCertificateReplacement(options, service);
  else if (positionals[0] === 'replace') {
    result = await replaceCertificate(
      options,
      {
        keyPath: filePath.parse(values['source-key']),
        certPath: filePath.parse(values['source-cert']),
      },
      service,
      confirmation,
    );
  } else {
    result = await recoverCertificateReplacement(
      options,
      z.enum(['previous', 'replacement']).parse(values.selection),
      {
        key: hash.parse(values['expected-key-sha256']),
        cert: hash.parse(values['expected-cert-sha256']),
      },
      service,
      { ...confirmation, operatorStopped: values['operator-stopped'] === true },
    );
  }
  process.stdout.write(
    JSON.stringify({ event: 'certificate_' + positionals[0], result }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"certificate_operation_failed","message":"Use protected bound host configuration and explicit maintenance/installation confirmations. Keep maintenance active after a stop attempt; inspect the certificate operation before recovery. Do not clear locks or disable TLS verification."}\n',
  );
  process.exitCode = 1;
}
