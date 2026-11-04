// Publisher-only assembly/signing boundary. Never installs services, downloads
// tools, creates signing keys or executes vendor binaries.
import { createHash } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { z } from 'zod';
import { assembleWindowsRuntime, fileHash } from './windows-runtime.js';
import { signReleasePackage } from './release.js';
import {
  inspectReleaseFiles,
  parseReleaseManifest,
  assertReleaseCompatibility,
} from '../../apps/api/src/operations/release-package.js';
import {
  offlineArtifactReviewSchema,
  verifyOfflineRelease,
} from '../../apps/api/src/operations/offline-installer.js';
import { loadEntitlementTrust } from '../../apps/api/src/licensing/entitlement.js';
import { secureDirectory } from '../../apps/api/src/operations/release-staging.js';
import { readBounded } from './inputs.js';
import { verifyWindowsVendor } from './windows-vendor.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().refine(isAbsolute);
const metadataSchema = z
  .object({
    format: z.literal(1),
    version: z.string(),
    minimumInstalledVersion: z.string(),
    fromSchemaDigest: hash,
    toSchemaDigest: hash,
    nodeMajor: z.literal(24),
    postgresMajor: z.literal(18),
  })
  .strict();
export const bundleConfigurationSchema = z
  .object({
    format: z.literal(1),
    repositoryRoot: absolute,
    outputDirectory: absolute,
    metadata: metadataSchema,
    vendor: z
      .object({
        directory: absolute,
        reviewFile: absolute,
        approvalFile: absolute.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const vendorApprovalSchema = z
  .object({
    format: z.literal(1),
    reviewSha256: hash,
    approvedBy: z.string().trim().min(1).max(120),
    approvedAt: z.string().datetime(),
    licensesReviewed: z.literal(true),
    files: z.record(z.string(), hash),
    evidence: z.array(z.string().url()).min(1).max(30),
  })
  .strict();
const helpers = [
  'Common.ps1',
  'DeploymentChecks.ps1',
  'OfflineInstaller.ps1',
  'Start-OfflinePostgres.ps1',
  'Set-BackupSchedule.ps1',
  'Invoke-BackupJob.ps1',
  'BackupInstallation.ps1',
] as const;
const operatorHelpers = [
  ...helpers,
  'OfflineRepair.ps1',
  'UpdateService.ps1',
  'Invoke-UpdateService.ps1',
] as const;
function child(root: string, path: string) {
  const target = resolve(root, ...path.split('/'));
  const r = relative(root, target);
  if (!r || isAbsolute(r) || r === '..' || r.startsWith('..' + sep))
    throw new Error('Bundle path escaped root.');
  return target;
}
async function save(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
}
async function copy(source: string, target: string) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('Ordinary input file required.');
  const before = await fileHash(source);
  await mkdir(resolve(target, '..'), { recursive: true });
  await copyFile(source, target, 1);
  if (
    (await fileHash(target)) !== before ||
    (await fileHash(source)) !== before
  )
    throw new Error('Bundle input changed.');
}
async function migrationDigest(repository: string) {
  const { readdir } = await import('node:fs/promises');
  const root = join(repository, 'packages', 'database', 'migrations'),
    digest = createHash('sha256');
  for (const name of (await readdir(root))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
    .sort()) {
    digest.update(name);
    digest.update(await readFile(join(root, name)));
  }
  return digest.digest('hex');
}
function approvedVersions(review: z.infer<typeof offlineArtifactReviewSchema>) {
  const [major, minor, patch] = review.node.version.split('.').map(Number);
  if (
    major !== 24 ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    minor! < 22 ||
    (minor === 22 && patch! < 1) ||
    !/^18\.(?:[6-9]|[1-9]\d+)$/.test(review.postgres.version) ||
    !review.node.origin.startsWith('https://nodejs.org/dist/') ||
    !review.postgres.origin.startsWith(
      'https://get.enterprisedb.com/postgresql/',
    )
  )
    throw new Error('Unsupported reviewed vendor version/source.');
}
async function copyVendor(
  root: string,
  input: NonNullable<z.infer<typeof bundleConfigurationSchema>['vendor']>,
) {
  const raw = await readBounded(input.reviewFile, 32768),
    review = offlineArtifactReviewSchema.parse(
      JSON.parse(raw.toString('utf8')),
    );
  approvedVersions(review);
  let approval: z.infer<typeof vendorApprovalSchema> | undefined;
  if (input.approvalFile) {
    approval = vendorApprovalSchema.parse(
      JSON.parse(
        (await readBounded(input.approvalFile, 32768)).toString('utf8'),
      ),
    );
    if (
      approval.reviewSha256 !== createHash('sha256').update(raw).digest('hex')
    )
      throw new Error('Approved review changed.');
  }
  const paths = new Set([
    review.node.archive,
    review.postgres.archive,
    review.winsw.file,
    ...review.node.notices,
    ...review.postgres.notices,
    ...review.winsw.notices,
  ]);
  for (const path of paths) {
    const source = child(input.directory, path);
    if (approval && approval.files[path] !== (await fileHash(source)))
      throw new Error('Independent approved artifact/notice pin mismatch.');
    await copy(source, child(root, path));
  }
  await copy(input.reviewFile, join(root, 'artifact-review.json'));
  if (approval) await save(join(root, 'vendor-approval.json'), approval);
  return { approved: !!approval, review };
}
export async function assembleWindowsBundle(configuration: unknown) {
  const config = bundleConfigurationSchema.parse(configuration),
    output = resolve(config.outputDirectory),
    repository = resolve(config.repositoryRoot);
  // Validate metadata without trusting caller-supplied file inventories.
  const validatedMetadata = parseReleaseManifest({
    ...config.metadata,
    files: [{ path: 'validation.txt', bytes: 0, sha256: '0'.repeat(64) }],
  });
  assertReleaseCompatibility(validatedMetadata, {
    version: config.metadata.minimumInstalledVersion,
    schemaDigest: config.metadata.fromSchemaDigest,
  });
  if (config.metadata.version === config.metadata.minimumInstalledVersion)
    throw new Error('Release version must advance its baseline.');
  if (config.metadata.toSchemaDigest !== (await migrationDigest(repository)))
    throw new Error('Build metadata does not match source migrations.');
  const beforeLock = await fileHash(join(repository, 'pnpm-lock.yaml'));
  const r = relative(repository, output);
  if (
    r === '' ||
    (!isAbsolute(r) &&
      r !== '..' &&
      !r.startsWith('..' + sep) &&
      !r.startsWith('.local' + sep))
  )
    throw new Error('Output overlaps project source.');
  await mkdir(output);
  await secureDirectory(output);
  const root = join(output, 'bundle');
  await mkdir(root);
  const runtime = await assembleWindowsRuntime(
    repository,
    join(root, 'app'),
    config.metadata.version,
  );
  for (const name of helpers)
    await copy(
      join(repository, 'apps', 'windows-installer', 'scripts', name),
      join(root, 'installer', name),
    );
  for (const name of operatorHelpers)
    await copy(
      join(repository, 'apps', 'windows-installer', 'scripts', name),
      join(root, 'app', 'apps', 'windows-installer', 'scripts', name),
    );
  const vendor = config.vendor
    ? await copyVendor(root, config.vendor)
    : undefined;
  if (vendor)
    await save(
      join(root, 'vendor-inspection.json'),
      await verifyWindowsVendor(root, vendor.review),
    );
  if (
    beforeLock !== (await fileHash(join(repository, 'pnpm-lock.yaml'))) ||
    runtime.lockSha256 !== beforeLock
  )
    throw new Error('Lockfile changed during build.');
  const applicationFiles = await inspectReleaseFiles(join(root, 'app'));
  const files = await inspectReleaseFiles(root);
  await save(join(output, 'release-metadata.json'), config.metadata);
  const needs = [
    'release-signatures',
    'authenticode-distribution-signing',
    'native-windows-acceptance',
  ];
  if (!vendor) needs.unshift('reviewed-vendor-payloads');
  else if (!vendor.approved) needs.unshift('independent-vendor-approval');
  const report = {
    format: 1,
    status: 'unsigned-candidate',
    target: 'win32-x64',
    version: config.metadata.version,
    files: files.length,
    bytes: files.reduce((n, file) => n + file.bytes, 0),
    packages: runtime.packages.length,
    lockSha256: runtime.lockSha256,
    applicationInventorySha256: createHash('sha256')
      .update(JSON.stringify(applicationFiles))
      .digest('hex'),
    needs,
  };
  await save(join(output, 'build-report.json'), report);
  return { root, report };
}
async function checkBundleContents(root: string) {
  const reviewBytes = await readBounded(
      join(root, 'artifact-review.json'),
      32768,
    ),
    review = offlineArtifactReviewSchema.parse(
      JSON.parse(reviewBytes.toString('utf8')),
    );
  approvedVersions(review);
  const approval = vendorApprovalSchema.parse(
    JSON.parse(
      (await readBounded(join(root, 'vendor-approval.json'), 32768)).toString(
        'utf8',
      ),
    ),
  );
  if (
    approval.reviewSha256 !==
    createHash('sha256').update(reviewBytes).digest('hex')
  )
    throw new Error('Vendor review pin changed.');
  for (const path of new Set([
    review.node.archive,
    review.postgres.archive,
    review.winsw.file,
    ...review.node.notices,
    ...review.postgres.notices,
    ...review.winsw.notices,
  ]))
    if (approval.files[path] !== (await fileHash(child(root, path))))
      throw new Error('Approved vendor payload changed.');
  for (const name of helpers)
    if (!(await lstat(join(root, 'installer', name))).isFile())
      throw new Error('Installer helper missing.');
  for (const path of [
    'apps/api/dist/main.js',
    'apps/api/dist/operations/offline-install-cli.js',
    'apps/api/dist/operations/offline-repair-ready-cli.js',
    'apps/api/dist/operations/offline-repair-tree-cli.js',
    'apps/web/dist/index.html',
    'packages/database/dist/install-cli.js',
    'packages/database/dist/verify-retained-cli.js',
    'packages/database/dist/backup-cli.js',
    'packages/database/migrations/meta/_journal.json',
  ])
    if (!(await lstat(child(join(root, 'app'), path))).isFile())
      throw new Error('Compiled runtime entrypoint missing.');
  return review;
}
export async function sealWindowsBundle(options: {
  root: string;
  metadata: unknown;
  keyId: string;
  privateKey: KeyObject;
  trust: unknown;
}) {
  const root = resolve(options.root);
  await verifyWindowsVendor(root, await checkBundleContents(root));
  const metadata = metadataSchema.parse(options.metadata);
  const runtime = JSON.parse(
    (await readBounded(join(root, 'app', 'package.json'), 32768)).toString(
      'utf8',
    ),
  );
  if (
    runtime.version !== metadata.version ||
    (await migrationDigest(join(root, 'app'))) !== metadata.toSchemaDigest
  )
    throw new Error('Signed metadata must match the assembled runtime.');
  const signer = {
    metadata,
    keyId: options.keyId,
    privateKey: options.privateKey,
    trust: options.trust,
  };
  await signReleasePackage({ ...signer, root: join(root, 'app') });
  await signReleasePackage({ ...signer, root });
  return verifyWindowsBundle(root, options.trust);
}
export async function verifyWindowsBundle(root: string, publicTrust: unknown) {
  const trust = loadEntitlementTrust(publicTrust),
    outer = await verifyOfflineRelease(root, trust),
    application = await verifyOfflineRelease(join(root, 'app'), trust);
  const review = await checkBundleContents(root);
  await verifyWindowsVendor(root, review);
  if (
    outer.version !== application.version ||
    outer.toSchemaDigest !== application.toSchemaDigest ||
    outer.fromSchemaDigest !== application.fromSchemaDigest
  )
    throw new Error('Application/bundle release metadata differs.');
  const runtime = JSON.parse(
    (await readBounded(join(root, 'app', 'package.json'), 32768)).toString(
      'utf8',
    ),
  );
  if (
    runtime.version !== application.version ||
    (await migrationDigest(join(root, 'app'))) !== application.toSchemaDigest
  )
    throw new Error('Packaged migration/version digest mismatch.');
  return {
    version: outer.version,
    schemaDigest: outer.toSchemaDigest,
    files: outer.files.length,
    platform: 'win32-x64',
    nodeVersion: review.node.version,
    postgresVersion: review.postgres.version,
  };
}
