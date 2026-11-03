import { join, win32 } from 'node:path';
import { isIP } from 'node:net';
import { z } from 'zod';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { readCertificateOperationFile } from './certificate-replacement.js';
import {
  parseReleaseManifest,
  verifyReleasePackage,
} from './release-package.js';
import { migrationDigest } from '@gst/database/operations';
import { loadServerTls } from '../tls.js';
import {
  certificateHash,
  certificateLeafHash,
  verifyCertificateTrust,
} from './certificate-probe.js';
import { emailSchema, passwordSchema } from '@gst/contracts';
import { assertPrivateDirectory } from './release-staging.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const safeComponent = (v: string) =>
  v !== '.' &&
  v !== '..' &&
  !/[<>:"|?*]/.test(v) &&
  ![...v].some((character) => character.charCodeAt(0) < 32) &&
  !/[. ]$/.test(v) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v);
const path = z
  .string()
  .max(180)
  .regex(/^[a-zA-Z]:\\[^"%#\r\n]+$/)
  .refine(
    (v) =>
      win32.normalize(v) === v &&
      !v.endsWith('\\') &&
      v.slice(3).split('\\').every(safeComponent),
  );
const relative = z
  .string()
  .max(240)
  .regex(/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/)
  .refine((v) => v.split('/').every(safeComponent));
const privateSubnet = z
  .string()
  .max(32)
  .refine((value) => {
    const [address, mask, ...extra] = value.split('/');
    if (
      extra.length ||
      !address ||
      isIP(address) !== 4 ||
      !mask ||
      !/^(?:[1-9]|[12]\d|3[0-2])$/.test(mask)
    )
      return false;
    const b = address.split('.').map(Number);
    const prefix = Number(mask);
    const privateRange =
      (b[0] === 10 && prefix >= 8) ||
      (b[0] === 172 && b[1]! >= 16 && b[1]! <= 31 && prefix >= 12) ||
      (b[0] === 192 && b[1] === 168 && prefix >= 16);
    const number = b.reduce((n, v) => (n << 8n) + BigInt(v), 0n);
    return privateRange && (number & ((1n << BigInt(32 - prefix)) - 1n)) === 0n;
  });
export const offlineInstallSchema = z
  .object({
    format: z.literal(1),
    installationId: z.string().uuid(),
    root: path.refine((v) => v.length <= 100),
    bundleRoot: path,
    releaseTrustFile: path,
    origin: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === 'https:' &&
          u.origin === v &&
          !u.username &&
          !u.password &&
          Number(u.port) >= 1024
        );
      }),
    databasePort: z.number().int().min(1024).max(65535),
    privateSubnet,
    tlsKeyFile: path,
    tlsCertFile: path,
    certificateTrustFile: path,
    certificateTrustSha256: hash,
    entitlementTrustFile: path,
    ownerInputFile: path,
    backupCredentialFile: path,
    backupAccountSid: z.string().regex(/^S-1-5-21-\d+-\d+-\d+-\d+$/),
    backupDailyAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();
const artifact = z
  .object({
    archive: relative,
    directory: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .refine(safeComponent),
    version: z.string().max(40),
    origin: z.string().url(),
    notices: z.array(relative).min(1).max(30),
    executables: z.record(z.string(), hash),
  })
  .strict();
const reviewSchema = z
  .object({
    format: z.literal(1),
    reviewReference: z.string().trim().min(1).max(120),
    reviewedAt: z.string().datetime(),
    node: artifact,
    postgres: artifact,
    winsw: z
      .object({
        file: relative,
        version: z.literal('2.12.0'),
        variant: z.literal('NET461'),
        origin: z.literal(
          'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
        ),
        notices: z.array(relative).min(1).max(10),
      })
      .strict(),
  })
  .strict();
async function json(file: string, maximum = 32768) {
  return JSON.parse(
    (await readCertificateOperationFile(file, maximum)).toString('utf8'),
  ) as unknown;
}
async function release(
  root: string,
  trust: ReturnType<typeof loadEntitlementTrust>,
) {
  const envelope = (await json(join(root, 'release.json'), 2097152)) as {
    payload: unknown;
  };
  const unverified = parseReleaseManifest(
    JSON.parse(
      Buffer.from(
        z.string().max(2097152).parse(envelope.payload),
        'base64url',
      ).toString('utf8'),
    ),
  );
  return verifyReleasePackage(root, trust, {
    version: unverified.minimumInstalledVersion,
    schemaDigest: unverified.fromSchemaDigest,
  });
}
export async function prepareOfflineInstallation(configuration: unknown) {
  const config = offlineInstallSchema.parse(configuration);
  const within = (root: string, file: string) => {
    const r = win32.relative(root, file);
    return (
      r === '' || (!r.startsWith('..\\') && r !== '..' && !win32.isAbsolute(r))
    );
  };
  if (
    within(config.root, config.bundleRoot) ||
    within(config.bundleRoot, config.root) ||
    Number(new URL(config.origin).port) === config.databasePort
  )
    throw new Error('Separate new installation root and ports required.');
  for (const file of [
    config.releaseTrustFile,
    config.tlsKeyFile,
    config.tlsCertFile,
    config.certificateTrustFile,
    config.entitlementTrustFile,
    config.ownerInputFile,
    config.backupCredentialFile,
  ]) {
    if (within(config.root, file))
      throw new Error('Installer inputs must be outside the new root.');
    await assertPrivateDirectory(win32.dirname(file));
  }
  const inputs: Record<string, string> = {};
  for (const file of [
    config.releaseTrustFile,
    config.tlsKeyFile,
    config.tlsCertFile,
    config.certificateTrustFile,
    config.entitlementTrustFile,
    config.ownerInputFile,
    config.backupCredentialFile,
  ]) {
    const bytes = await readCertificateOperationFile(file, 1048576);
    try {
      inputs[file] = certificateHash(bytes);
    } finally {
      bytes.fill(0);
    }
  }
  const trust = loadEntitlementTrust(await json(config.releaseTrustFile));
  const bundle = await release(config.bundleRoot, trust);
  const application = await release(join(config.bundleRoot, 'app'), trust);
  if (
    bundle.version !== application.version ||
    bundle.toSchemaDigest !== application.toSchemaDigest ||
    application.toSchemaDigest !== (await migrationDigest())
  )
    throw new Error(
      'Matching signed application and operator migrations required.',
    );
  const applicationFiles = new Set(application.files.map((f) => f.path));
  for (const file of [
    'apps/api/dist/main.js',
    'apps/api/dist/security/host-cli.js',
    'apps/api/dist/operations/offline-ready-cli.js',
    'apps/web/dist/index.html',
    'packages/database/dist/install-cli.js',
    'packages/database/dist/backup-cli.js',
    'packages/database/migrations/meta/_journal.json',
  ])
    if (!applicationFiles.has(file))
      throw new Error('Required signed application entrypoint missing.');
  const review = reviewSchema.parse(
    await json(join(config.bundleRoot, 'artifact-review.json')),
  );
  if (
    !/^24\.(?:\d+)\.(?:\d+)$/.test(review.node.version) ||
    Number(review.node.version.split('.')[1]) < 22 ||
    (Number(review.node.version.split('.')[1]) === 22 &&
      Number(review.node.version.split('.')[2]) < 1) ||
    !/^18\.(?:[6-9]|[1-9]\d+)$/.test(review.postgres.version) ||
    !review.node.origin.startsWith('https://nodejs.org/dist/') ||
    !review.postgres.origin.startsWith(
      'https://get.enterprisedb.com/postgresql/',
    )
  )
    throw new Error('Approved supported vendor versions required.');
  const inventory = new Map(bundle.files.map((f) => [f.path, f]));
  for (const item of [review.node, review.postgres]) {
    if (!item.archive.endsWith('.zip') || !inventory.has(item.archive))
      throw new Error('Signed vendor archive missing.');
    for (const executable of Object.keys(item.executables))
      relative.parse(executable);
  }
  for (const item of [review.node, review.postgres, review.winsw])
    for (const notice of item.notices) {
      const record = inventory.get(notice);
      if (!record || record.bytes === 0)
        throw new Error('Signed redistribution notices missing.');
    }
  if (
    !inventory.has(review.winsw.file) ||
    !review.node.executables['node.exe'] ||
    [
      'postgres.exe',
      'initdb.exe',
      'pg_ctl.exe',
      'psql.exe',
      'pg_isready.exe',
      'pg_dump.exe',
      'pg_restore.exe',
    ].some((n) => !review.postgres.executables['bin/' + n])
  )
    throw new Error('Approved executable inventory missing.');
  const owner = z
    .object({
      organizationName: z.string().trim().min(1).max(200),
      organizationId: z.string().uuid().optional(),
      email: emailSchema,
      name: z.string().trim().min(1).max(120),
      password: passwordSchema,
    })
    .strict()
    .parse(await json(config.ownerInputFile, 16384));
  // Validate only; no credentials are returned in the native plan or logs.
  void owner;
  loadEntitlementTrust(await json(config.entitlementTrustFile));
  const ca = await readCertificateOperationFile(
    config.certificateTrustFile,
    262144,
  );
  if (certificateHash(ca) !== config.certificateTrustSha256)
    throw new Error('Approved certificate trust changed.');
  const tls = loadServerTls({
    TLS_KEY_PATH: config.tlsKeyFile,
    TLS_CERT_PATH: config.tlsCertFile,
    APP_ORIGIN: config.origin,
  })!;
  const leafSha256 = certificateLeafHash(tls.httpsOptions.cert);
  try {
    await verifyCertificateTrust(tls, config.origin, ca);
  } finally {
    tls.httpsOptions.key.fill(0);
  }
  const files = bundle.files.map((file) => ({
    ...file,
    destination: file.path.startsWith('app/')
      ? 'releases/' + application.version + '/' + file.path.slice(4)
      : 'payload/' + file.path,
  }));
  if (
    review.node.directory === review.postgres.directory ||
    review.node.archive === review.postgres.archive ||
    [review.node.directory, review.postgres.directory].some(
      (v) => v === '.' || v === '..',
    ) ||
    files.some((f) => win32.join(config.root, f.destination).length > 240)
  )
    throw new Error(
      'Separate vendor trees and bounded destination paths required.',
    );
  const required = [
    'installer/OfflineInstaller.ps1',
    'installer/Start-OfflinePostgres.ps1',
    'installer/Common.ps1',
    'installer/DeploymentChecks.ps1',
    'installer/Set-BackupSchedule.ps1',
    'installer/Invoke-BackupJob.ps1',
    'installer/BackupInstallation.ps1',
  ];
  for (const file of required)
    if (!inventory.has(file))
      throw new Error('Signed installer helper missing.');
  for (const [file, digest] of Object.entries(inputs)) {
    const bytes = await readCertificateOperationFile(file, 1048576);
    try {
      if (certificateHash(bytes) !== digest)
        throw new Error('Installer inputs changed during preflight.');
    } finally {
      bytes.fill(0);
    }
  }
  return {
    format: 1 as const,
    config,
    review,
    files,
    version: application.version,
    schemaDigest: application.toSchemaDigest,
    inputs,
    leafSha256,
  };
}
