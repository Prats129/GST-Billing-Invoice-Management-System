// Publisher-side assembly. Never installs services or uses a private signing key.
import { execFile } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inspectReleaseFiles } from '../../apps/api/src/operations/release-package.js';
import { secureDirectory } from '../../apps/api/src/operations/release-staging.js';
import { verifyWindowsBundle } from './windows-bundle.js';
import { offlineArtifactReviewSchema } from '../../apps/api/src/operations/offline-installer.js';
import { verifyOfflineRelease } from '../../apps/api/src/operations/offline-installer.js';
import { loadEntitlementTrust } from '../../apps/api/src/licensing/entitlement.js';
import { readBounded } from './inputs.js';
import { fileHash } from './windows-runtime.js';

export async function buildWindowsLauncher(options: {
  bundle: string;
  trust: unknown;
  output: string;
  publisherCertificate?: string;
}) {
  if (process.platform !== 'win32')
    throw new Error('Build the Windows launcher on Windows.');
  const bundle = resolve(options.bundle),
    output = resolve(options.output);
  const verified = await verifyWindowsBundle(bundle, options.trust);
  const signingTrust = loadEntitlementTrust(options.trust);
  const signedOuter = await verifyOfflineRelease(bundle, signingTrust);
  const signedApplication = await verifyOfflineRelease(
    join(bundle, 'app'),
    signingTrust,
  );
  let publisherCertificateSha256 = '0'.repeat(64);
  let signingPurpose = 'publisher-candidate';
  if (options.publisherCertificate) {
    const certificate = new X509Certificate(
      await readBounded(options.publisherCertificate, 65536),
    );
    publisherCertificateSha256 = createHash('sha256')
      .update(certificate.raw)
      .digest('hex');
    if (
      certificate.subject === 'CN=GST Billing INTERNAL TEST ONLY' &&
      certificate.issuer === certificate.subject
    )
      signingPurpose = 'internal-test';
  }
  await mkdir(output);
  await secureDirectory(output);
  const runtime = join(output, 'maintenance');
  await mkdir(runtime);
  await writeFile(
    join(runtime, 'release-trust.json'),
    JSON.stringify(options.trust),
    { flag: 'wx', mode: 0o600 },
  );
  const application = join(bundle, 'app');
  const files = signedApplication.files;
  const envelope = signedOuter.files.find(
    (file) => file.path === 'app/release.json',
  );
  if (!envelope) throw new Error('Signed application envelope missing.');
  for (const file of [
    ...files,
    {
      path: 'release.json',
      bytes: envelope.bytes,
      sha256: envelope.sha256,
    },
  ]) {
    const source = join(application, ...file.path.split('/'));
    const target = join(runtime, 'app', ...file.path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target, constants.COPYFILE_EXCL);
    if (
      (await fileHash(target)) !== file.sha256 ||
      (await fileHash(source)) !== file.sha256
    )
      throw new Error(
        'Application changed while assembling maintenance runtime.',
      );
  }
  const reviewBytes = await readBounded(
    join(bundle, 'artifact-review.json'),
    32768,
  );
  if (
    createHash('sha256').update(reviewBytes).digest('hex') !==
    signedOuter.files.find((file) => file.path === 'artifact-review.json')
      ?.sha256
  )
    throw new Error('Signed vendor review changed.');
  const review = offlineArtifactReviewSchema.parse(
    JSON.parse(reviewBytes.toString('utf8')),
  );
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const powershell = join(
    system,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  // The already verified archive is read as data; no vendor binary is launched.
  const script = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$zip=[IO.Compression.ZipFile]::OpenRead($env:GST_NODE_ARCHIVE)',
    'try {',
    '$entry=$zip.GetEntry($env:GST_NODE_ENTRY)',
    "if($null-eq $entry -or $entry.Length-gt 209715200){throw 'Invalid node entry.'}",
    '$from=$entry.Open();$to=New-Object IO.FileStream($env:GST_NODE_TARGET,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)',
    'try {$from.CopyTo($to);$to.Flush($true)}finally{$from.Dispose();$to.Dispose()}',
    '}finally{$zip.Dispose()}',
  ].join('\n');
  await promisify(execFile)(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      maxBuffer: 16384,
      env: {
        SystemRoot: system,
        WINDIR: system,
        GST_NODE_ARCHIVE: join(bundle, review.node.archive),
        GST_NODE_ENTRY: review.node.directory + '/node.exe',
        GST_NODE_TARGET: join(runtime, 'node.exe'),
      },
    },
  );
  if (
    (await fileHash(join(runtime, 'node.exe'))) !==
    review.node.executables['node.exe']
  )
    throw new Error(
      'Bootstrap runtime pin does not match the approved Node payload.',
    );
  const inventory = {
    format: 1,
    publisherCertificateSha256,
    signingPurpose,
    files: await inspectReleaseFiles(runtime),
  };
  await writeFile(join(output, 'bootstrap.json'), JSON.stringify(inventory), {
    flag: 'wx',
    mode: 0o600,
  });
  const directory = fileURLToPath(
    new URL('../../apps/windows-installer/launcher/', import.meta.url),
  );
  await promisify(execFile)(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'Build-WindowsLauncher.ps1'),
      '-OutputPath',
      join(runtime, 'GSTBillingMaintenance.exe'),
      '-InventoryPath',
      join(output, 'bootstrap.json'),
    ],
    { windowsHide: true, maxBuffer: 16384 },
  );
  // Reverify source bundle after copying and compiling. No partial output is reused.
  await verifyWindowsBundle(bundle, options.trust);
  const exe = await lstat(join(runtime, 'GSTBillingMaintenance.exe'));
  if (!exe.isFile() || exe.size === 0)
    throw new Error('Native launcher missing.');
  const report = {
    format: 1,
    status: 'unsigned-candidate',
    signingPurpose,
    version: verified.version,
    publisherCertificateSha256,
    files: inventory.files.length,
    executableSha256: await fileHash(
      join(runtime, 'GSTBillingMaintenance.exe'),
    ),
    needs: [
      'authenticode-signing',
      'native-windows-acceptance',
      ...(signingPurpose === 'internal-test'
        ? ['internal-test-account-trust', 'production-code-signing-certificate']
        : []),
      ...(options.publisherCertificate
        ? []
        : ['publisher-code-signing-certificate']),
    ],
  };
  await writeFile(
    join(output, 'build-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return report;
}
