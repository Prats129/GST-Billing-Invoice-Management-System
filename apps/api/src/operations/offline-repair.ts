import { join, win32 } from 'node:path';
import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { migrationDigest } from '@gst/database/operations';
import {
  offlinePlanSchema,
  offlineInstallSchema,
  verifyOfflineRelease,
  offlineArtifactReviewSchema,
} from './offline-installer.js';
import { readInstallationState } from './installation-state.js';
import { readCertificateOperationFile } from './certificate-replacement.js';
import {
  certificateHash,
  certificateLeafHash,
  verifyCertificateTrust,
} from './certificate-probe.js';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { loadServerTls } from '../tls.js';
import { parseConfig } from '../config.js';
import { parse } from 'dotenv';
import { assertPrivateDirectory } from './release-staging.js';
import { parseReleaseManifest } from './release-package.js';

export const offlineRepairSchema = offlineInstallSchema
  .pick({
    bundleRoot: true,
    releaseTrustFile: true,
    certificateTrustFile: true,
    certificateTrustSha256: true,
    backupCredentialFile: true,
  })
  .strict();
export type OfflinePlan = z.infer<typeof offlinePlanSchema>;
async function json(path: string, max = 32768) {
  return JSON.parse(
    (await readCertificateOperationFile(path, max)).toString('utf8'),
  ) as unknown;
}
export async function readOfflinePlan(root: string) {
  await assertPrivateDirectory(join(root, 'operator'));
  const raw = await json(
    join(root, 'operator', 'native-installation.json'),
    16 * 1024 * 1024,
  );
  const plan = offlinePlanSchema.parse(raw);
  if (plan.config.root !== root) throw new Error('Wrong installation root.');
  return raw as OfflinePlan;
}
export async function retainedBinding(root: string) {
  const plan = await readOfflinePlan(root),
    state = await readInstallationState(join(root, 'operations'));
  if (
    state.installationId !== plan.config.installationId ||
    win32.dirname(state.appRoot) !== win32.join(root, 'releases') ||
    (win32.basename(state.appRoot) !== state.version &&
      !/^gst-release-[a-zA-Z0-9]{6}$/.test(win32.basename(state.appRoot)))
  )
    throw new Error('Wrong retained installation.');
  const installed = z
    .object({
      installationId: z.string().uuid(),
      state: z.literal('installed'),
      taskSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    })
    .strict()
    .parse(await json(join(root, 'operator', 'installed.json')));
  if (installed.installationId !== plan.config.installationId)
    throw new Error('Initial installation was not completed.');
  try {
    await lstat(join(root, 'operator', 'install.lock'));
    throw new Error('Initial install is unresolved.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const paths = [
    'operator/native-installation.json',
    'operator/installed.json',
    'operator/database-input.json',
    'operator/database-receipt.json',
    'operator/operator.env',
    'operator/backup.env',
    'runtime/runtime.env',
    'runtime/tls/key.pem',
    'runtime/tls/cert.pem',
    'runtime/entitlement-trust.json',
    'operator/backup-task.xml',
    'backup-key/backup.key',
    'backup-key/installation-id.txt',
    'operations/installation.json',
  ];
  const fingerprints: Record<string, string> = {};
  for (const path of paths) {
    const value = await readCertificateOperationFile(
      join(root, path),
      16 * 1024 * 1024,
    );
    try {
      if (path === 'backup-key/backup.key' && value.length !== 32)
        throw new Error('Invalid retained backup key.');
      if (
        path === 'backup-key/installation-id.txt' &&
        value.toString('utf8').trim() !== plan.config.installationId
      )
        throw new Error('Wrong backup identity.');
      fingerprints[path] = certificateHash(value);
    } finally {
      value.fill(0);
    }
  }
  if (
    fingerprints['operator/backup-task.xml'] !==
    installed.taskSha256.toLowerCase()
  )
    throw new Error('Backup definition receipt changed.');
  return {
    plan,
    state,
    fingerprints,
    binding: certificateHash(Buffer.from(JSON.stringify(fingerprints))),
  };
}
export async function prepareOfflineRepair(
  root: string,
  configuration: unknown,
) {
  const retained = await retainedBinding(root),
    config = offlineRepairSchema.parse(configuration),
    { plan, state } = retained;
  const relative = win32.relative(root, config.bundleRoot);
  if (
    relative === '' ||
    (!relative.startsWith('..\\') &&
      relative !== '..' &&
      !win32.isAbsolute(relative))
  )
    throw new Error('Repair source must be outside the retained installation.');
  const inputHashes: Record<string, string> = {};
  for (const path of Object.values(config).filter(
    (v) => /^[a-z]:\\/i.test(v) && v !== config.bundleRoot,
  )) {
    await assertPrivateDirectory(win32.dirname(path));
    const bytes = await readCertificateOperationFile(path, 1048576);
    try {
      inputHashes[path] = certificateHash(bytes);
    } finally {
      bytes.fill(0);
    }
  }
  const trust = loadEntitlementTrust(await json(config.releaseTrustFile));
  const bundle = await verifyOfflineRelease(config.bundleRoot, trust),
    application = await verifyOfflineRelease(
      join(config.bundleRoot, 'app'),
      trust,
    );
  if (
    bundle.version !== state.version ||
    application.version !== state.version ||
    bundle.toSchemaDigest !== state.schemaDigest ||
    application.toSchemaDigest !== state.schemaDigest ||
    state.schemaDigest !== (await migrationDigest())
  )
    throw new Error(
      'Repair requires the exact installed version/schema and matching operator release.',
    );
  const review = offlineArtifactReviewSchema.parse(
    await json(join(config.bundleRoot, 'artifact-review.json')),
  );
  if (JSON.stringify(review) !== JSON.stringify(plan.review))
    throw new Error('Repair cannot replace the approved toolset.');
  const inventory = new Map(bundle.files.map((file) => [file.path, file]));
  const normalize = (
    files: { path: string; bytes: number; sha256: string }[],
  ) =>
    JSON.stringify(
      files
        .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
        .sort((a, b) => a.path.localeCompare(b.path, 'en')),
    );
  let expectedFiles;
  if (
    state.version === plan.version &&
    state.schemaDigest === plan.schemaDigest
  ) {
    expectedFiles = plan.files
      .filter((f) => f.path.startsWith('app/') && f.path !== 'app/release.json')
      .map((f) => ({ ...f, path: f.path.slice(4) }));
  } else {
    if (!state.operationId)
      throw new Error('Original installed inventory unavailable.');
    const directory = join(
      root,
      'operations',
      'gst-update-' + state.operationId,
    );
    await assertPrivateDirectory(directory);
    for (const name of ['target-manifest.json', 'original-manifest.json']) {
      const file = join(directory, name);
      let value;
      try {
        value = await readCertificateOperationFile(file, 2097152);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const receipt = parseReleaseManifest(JSON.parse(value.toString('utf8')));
      if (
        receipt.version === state.version &&
        receipt.toSchemaDigest === state.schemaDigest
      ) {
        expectedFiles = receipt.files;
        inputHashes[file] = certificateHash(value);
        break;
      }
    }
    if (!expectedFiles)
      throw new Error('Original installed inventory unavailable.');
  }
  if (normalize(expectedFiles) !== normalize(application.files))
    throw new Error('Repair cannot change the installed release inventory.');
  for (const path of [
    review.node.archive,
    review.postgres.archive,
    review.winsw.file,
  ]) {
    const original = plan.files.find((f) => f.path === path),
      current = inventory.get(path);
    if (
      !original ||
      !current ||
      original.sha256 !== current.sha256 ||
      original.bytes !== current.bytes
    )
      throw new Error('Approved vendor payload changed.');
  }
  const runtimeBytes = await readCertificateOperationFile(
    join(root, 'runtime', 'runtime.env'),
    32768,
  );
  let runtime;
  try {
    runtime = parseConfig(parse(runtimeBytes));
  } finally {
    runtimeBytes.fill(0);
  }
  if (
    runtime.NODE_ENV !== 'production' ||
    runtime.DEPLOYMENT_EDITION !== 'offline' ||
    runtime.OFFLINE_INSTALLATION_ID !== plan.config.installationId ||
    runtime.APP_ORIGIN !== plan.config.origin ||
    runtime.PORT !== Number(new URL(plan.config.origin).port) ||
    runtime.TLS_KEY_PATH !== join(root, 'runtime', 'tls', 'key.pem') ||
    runtime.TLS_CERT_PATH !== join(root, 'runtime', 'tls', 'cert.pem')
  )
    throw new Error('Retained runtime binding changed.');
  const ca = await readCertificateOperationFile(
    config.certificateTrustFile,
    262144,
  );
  if (certificateHash(ca) !== config.certificateTrustSha256)
    throw new Error('Wrong current certificate trust.');
  const tls = loadServerTls({
    APP_ORIGIN: plan.config.origin,
    TLS_KEY_PATH: join(root, 'runtime', 'tls', 'key.pem'),
    TLS_CERT_PATH: join(root, 'runtime', 'tls', 'cert.pem'),
  })!;
  const leafSha256 = certificateLeafHash(tls.httpsOptions.cert);
  try {
    await verifyCertificateTrust(tls, plan.config.origin, ca);
  } finally {
    tls.httpsOptions.key.fill(0);
  }
  const files = bundle.files
    .filter((f) => f.path.startsWith('app/'))
    .map((f) => ({
      ...f,
      source: join(config.bundleRoot, f.path),
      destination: win32.join(state.appRoot, ...f.path.slice(4).split('/')),
    }));
  if (files.some((file) => file.destination.length > 240))
    throw new Error('Repair destination exceeds supported Windows length.');
  if (
    !files.some((f) => f.path === 'app/release.json') ||
    !files.some((f) => f.path === 'app/apps/api/dist/main.js')
  )
    throw new Error('Signed application files missing.');
  for (const [path, expected] of Object.entries(inputHashes)) {
    const bytes = await readCertificateOperationFile(path, 2097152);
    try {
      if (certificateHash(bytes) !== expected)
        throw new Error('Repair inputs changed.');
    } finally {
      bytes.fill(0);
    }
  }
  return {
    config,
    files,
    inputHashes,
    leafSha256,
    host: runtime.HOST,
    appRoot: state.appRoot,
    version: state.version,
    schemaDigest: state.schemaDigest,
    nodeArchive: inventory.get(review.node.archive)!,
    postgresArchive: inventory.get(review.postgres.archive)!,
    wrapper: inventory.get(review.winsw.file)!,
  };
}
export type OfflineRepair = Awaited<ReturnType<typeof prepareOfflineRepair>>;
