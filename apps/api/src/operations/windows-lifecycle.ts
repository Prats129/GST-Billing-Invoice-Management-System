// Host-only facade for the native launcher. No HTTP controller imports this.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { z } from 'zod';
import { createDatabase } from '@gst/database';
import { migrationDigest } from '@gst/database/operations';
import { parseConfig } from '../config.js';
import {
  loadEntitlementTrust,
  verifyEntitlement,
} from '../licensing/entitlement.js';
import { installEntitlement } from '../licensing/install.js';
import { checkOfflineUpdateEligibility } from './update-eligibility.js';
import {
  prepareOfflineInstallation,
  offlineInstallSchema,
  offlinePlanSchema,
  verifyOfflineRelease,
} from './offline-installer.js';
import {
  retainedBinding,
  prepareOfflineRepair,
  offlineRepairSchema,
} from './offline-repair.js';
import { createOfflineNativeHost, installOffline } from './offline-native.js';
import {
  runOfflineMaintenance,
  inspectOfflineMaintenance,
  recoverOfflineMaintenance,
  readOfflineMaintenanceContext,
} from './offline-maintenance.js';
import {
  assertPrivateDirectory,
  stageReleasePackage,
} from './release-staging.js';
import {
  certificateHash,
  verifyCertificateTrust,
} from './certificate-probe.js';
import {
  readCertificateOperationFile,
  replaceCertificate,
  inspectCertificateReplacement,
  recoverCertificateReplacement,
} from './certificate-replacement.js';
import { loadServerTls } from '../tls.js';
import { createWindowsUpdateHost } from './windows-update-host.js';
import { createWindowsCertificateService } from './windows-update-service.js';
import { runAssistedUpdate } from './assisted-update.js';
import { inspectFailedUpdate, recoverFailedUpdate } from './update-recovery.js';
import type { UpdateRecoveryOptions } from './update-recovery.js';

const path = offlineInstallSchema.shape.bundleRoot;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = { root: path };
export const lifecycleRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), ...base }).strict(),
  z
    .object({
      action: z.literal('install'),
      configuration: offlineInstallSchema,
    })
    .strict(),
  z.object({ action: z.literal('license'), ...base, file: path }).strict(),
  z.object({ action: z.literal('backup'), ...base }).strict(),
  z
    .object({
      action: z.literal('update'),
      ...base,
      bundleRoot: path,
      releaseTrustFile: path,
    })
    .strict(),
  z
    .object({
      action: z.literal('repair'),
      ...base,
      configuration: offlineRepairSchema,
    })
    .strict(),
  z.object({ action: z.literal('uninstall'), ...base }).strict(),
  z.object({ action: z.literal('inspect'), ...base }).strict(),
  z
    .object({
      action: z.literal('recover'),
      ...base,
      operatorStopped: z.literal(true),
      acceptRecoveryPoint: z.literal(true),
      selection: z.enum(['previous', 'replacement']).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('certificate'),
      ...base,
      keyFile: path,
      certFile: path,
      trustFile: path,
      trustSha256: hash,
    })
    .strict(),
]);
export type LifecycleRequest = z.infer<typeof lifecycleRequestSchema>;
const json = async (file: string, max = 32768) =>
  JSON.parse(
    (await readCertificateOperationFile(file, max)).toString('utf8'),
  ) as unknown;
const digest = (value: unknown) =>
  certificateHash(Buffer.from(JSON.stringify(value)));
async function inputHash(file: string, maximum: number) {
  const bytes = await readCertificateOperationFile(file, maximum);
  try {
    return certificateHash(bytes);
  } finally {
    bytes.fill(0);
  }
}
const scriptDirectory = fileURLToPath(
  new URL('../../../windows-installer/scripts/', import.meta.url),
);

export class LifecycleError extends Error {
  constructor(
    readonly code: 'INPUT_INVALID' | 'TARGET_CHANGED' | 'OPERATION_FAILED',
  ) {
    super(
      {
        INPUT_INVALID: 'Check the selected files and installation details.',
        TARGET_CHANGED:
          'The installation or selected input changed after review. Check it again before continuing.',
        OPERATION_FAILED:
          'The operation could not be verified as complete. Retain all data and recovery records. Open Interrupted operation before retrying.',
      }[code],
    );
  }
}
function within(root: string, target: string) {
  const r = win32.relative(root, target);
  return (
    r === '' || (!win32.isAbsolute(r) && r !== '..' && !r.startsWith('..\\'))
  );
}
async function readEnvironment(file: string) {
  const bytes = await readCertificateOperationFile(file, 32768);
  try {
    return parse(bytes);
  } finally {
    bytes.fill(0);
  }
}
async function publisherTrust(file: string) {
  const supplied = loadEntitlementTrust(await json(file));
  const pinned = loadEntitlementTrust(
    await json(
      fileURLToPath(
        new URL('../../../../../release-trust.json', import.meta.url),
      ),
    ),
  );
  for (const [id, key] of supplied) {
    if (
      key.export({ type: 'spki', format: 'pem' }) !==
      pinned.get(id)?.export({ type: 'spki', format: 'pem' })
    )
      throw new LifecycleError('INPUT_INVALID');
  }
  return supplied;
}
async function context(root: string) {
  const retained = await retainedBinding(root);
  const runtimeFile = join(root, 'runtime', 'runtime.env');
  const runtime = await readEnvironment(runtimeFile);
  const operator = await readEnvironment(
    join(root, 'operator', 'operator.env'),
  );
  const config = parseConfig({
    ...runtime,
    WEB_ROOT: join(retained.state.appRoot, 'apps', 'web', 'dist'),
  });
  if (
    config.NODE_ENV !== 'production' ||
    config.DEPLOYMENT_EDITION !== 'offline' ||
    config.OFFLINE_INSTALLATION_ID !== retained.plan.config.installationId ||
    config.APP_ORIGIN !== retained.plan.config.origin ||
    !operator.MIGRATION_DATABASE_URL ||
    operator.DATABASE_URL !== config.DATABASE_URL
  )
    throw new LifecycleError('INPUT_INVALID');
  const trust = loadEntitlementTrust(
    await json(join(root, 'runtime', 'entitlement-trust.json')),
  );
  return {
    ...retained,
    root,
    runtimeFile,
    config,
    connectionString: operator.MIGRATION_DATABASE_URL,
    trust,
  };
}
type Context = Awaited<ReturnType<typeof context>>;
async function noMaintenance(root: string) {
  try {
    await lstat(join(root, 'operations', 'gst-update.lock'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new LifecycleError('INPUT_INVALID');
}
async function scriptTrust() {
  await assertPrivateDirectory(scriptDirectory);
  const names = [
    'Invoke-UpdateService.ps1',
    'UpdateService.ps1',
    'Common.ps1',
    'DeploymentChecks.ps1',
  ] as const;
  const hashes = {} as Record<(typeof names)[number], string>;
  for (const name of names)
    hashes[name] = certificateHash(
      await readCertificateOperationFile(join(scriptDirectory, name), 131072),
    );
  return { directory: scriptDirectory, hashes };
}
async function service(
  c: Context,
  operationId: string,
  installedRoot: string,
  stagedRoot: string,
) {
  const nodePath = join(
    c.root,
    'vendor',
    c.plan.review.node.directory,
    'node.exe',
  );
  const wrapper = c.plan.files.find((f) => f.path === c.plan.review.winsw.file);
  if (!wrapper) throw new LifecycleError('INPUT_INVALID');
  return {
    operationId,
    serviceRoot: join(c.root, 'services', 'api'),
    nodePath,
    nodeSha256: c.plan.review.node.executables['node.exe']!,
    wrapperSha256: wrapper.sha256,
    installedRoot,
    stagedRoot,
    environmentFile: c.runtimeFile,
    environmentSha256: certificateHash(
      await readCertificateOperationFile(c.runtimeFile, 32768),
    ),
    journalDirectory: join(c.root, 'operations', 'gst-update-' + operationId),
    origin: c.config.APP_ORIGIN,
    port: c.config.PORT,
    backupTaskName: 'GSTBilling-Backup-' + c.plan.config.installationId,
    backupAccountSid: c.plan.config.backupAccountSid,
  };
}
async function backupOptions(c: Context) {
  const key = await readCertificateOperationFile(
    join(c.root, 'backup-key', 'backup.key'),
    32,
  );
  if (key.length !== 32) {
    key.fill(0);
    throw new LifecycleError('INPUT_INVALID');
  }
  return {
    connectionString: c.connectionString,
    key,
    installationId: c.plan.config.installationId,
    workDirectory: join(c.root, 'backup-work'),
    pgBinDirectory: join(
      c.root,
      'vendor',
      c.plan.review.postgres.directory,
      'bin',
    ),
  };
}
async function certificateOptions(
  c: Context,
  request: Extract<LifecycleRequest, { action: 'certificate' }>,
  operationId: string,
) {
  for (const file of [request.keyFile, request.certFile, request.trustFile])
    await assertPrivateDirectory(dirname(file));
  const ca = await readCertificateOperationFile(request.trustFile, 262144);
  if (certificateHash(ca) !== request.trustSha256)
    throw new LifecycleError('INPUT_INVALID');
  const tls = loadServerTls({
    APP_ORIGIN: c.config.APP_ORIGIN,
    TLS_KEY_PATH: request.keyFile,
    TLS_CERT_PATH: request.certFile,
  })!;
  try {
    await verifyCertificateTrust(tls, c.config.APP_ORIGIN, ca);
  } finally {
    tls.httpsOptions.key.fill(0);
  }
  return {
    installationId: c.plan.config.installationId,
    operationId,
    journalParent: join(c.root, 'operations'),
    keyPath: join(c.root, 'runtime', 'tls', 'key.pem'),
    certPath: join(c.root, 'runtime', 'tls', 'cert.pem'),
    webRoot: join(c.state.appRoot, 'apps', 'web', 'dist'),
    origin: c.config.APP_ORIGIN,
    trustFile: request.trustFile,
    trustSha256: request.trustSha256,
  };
}
async function interrupted(c: Context) {
  const parent = join(c.root, 'operations');
  const owner = z
    .object({
      operationId: z.string().uuid(),
      installationId: z.string().uuid(),
      nonce: z.string().uuid(),
    })
    .strict()
    .parse(await json(join(parent, 'gst-update.lock', 'owner.json'), 1024));
  if (owner.installationId !== c.plan.config.installationId)
    throw new LifecycleError('INPUT_INVALID');
  const directory = join(parent, 'gst-update-' + owner.operationId);
  const bytes = await readCertificateOperationFile(
    join(directory, 'events.jsonl'),
    1048576,
  );
  const header = z
    .object({
      operationKind: z.enum(['repair', 'uninstall', 'certificate']).optional(),
    })
    .passthrough()
    .parse(JSON.parse(bytes.toString('utf8').split('\n')[0]!));
  return {
    parent,
    directory,
    operationId: owner.operationId,
    kind: header.operationKind ?? 'update',
  };
}
async function maintenance(c: Context, operationId: string) {
  const saved = await readOfflineMaintenanceContext(
    join(c.root, 'operations'),
    operationId,
  );
  const repair =
    saved.configuration === undefined
      ? undefined
      : await prepareOfflineRepair(c.root, saved.configuration);
  return {
    host: await createOfflineNativeHost(c.plan, c.fingerprints, repair),
    options: {
      parent: join(c.root, 'operations'),
      installationId: c.plan.config.installationId,
      version: c.state.version,
      binding: digest({ retained: c.binding, repair }),
      ...(repair ? { repairConfiguration: repair.config } : {}),
    },
  };
}
async function updateRecovery(
  c: Context,
  i: Awaited<ReturnType<typeof interrupted>>,
) {
  const saved = z
    .object({
      installedRoot: path,
      stagedRoot: path,
      installed: z.object({ version: z.string(), schemaDigest: hash }).strict(),
      releaseTrustFile: path,
    })
    .strict()
    .parse(await json(join(i.directory, 'launcher-update.json')));
  if (
    !within(join(c.root, 'releases'), saved.installedRoot) ||
    !within(join(c.root, 'releases'), saved.stagedRoot)
  )
    throw new LifecycleError('INPUT_INVALID');
  const options: UpdateRecoveryOptions = {
    ...saved,
    operationId: i.operationId,
    installationId: c.plan.config.installationId,
    journalParent: i.parent,
    connectionString: c.connectionString,
    runtimeConnectionString: c.config.DATABASE_URL,
    releaseTrust: await publisherTrust(saved.releaseTrustFile),
  };
  const windows = await service(
    c,
    i.operationId,
    saved.installedRoot,
    saved.stagedRoot,
  );
  const { createWindowsUpdateService } =
    await import('./windows-update-service.js');
  return {
    options,
    service: createWindowsUpdateService(windows, await scriptTrust(), {
      runtimeConnectionString: c.config.DATABASE_URL,
      installationId: c.plan.config.installationId,
    }),
  };
}
async function inspect(c: Context) {
  const i = await interrupted(c);
  if (i.kind === 'repair' || i.kind === 'uninstall') {
    const m = await maintenance(c, i.operationId);
    return {
      ...i,
      inspection: await inspectOfflineMaintenance(
        m.options,
        i.operationId,
        m.host,
      ),
    };
  }
  if (i.kind === 'certificate') {
    const saved = z
      .object({ options: z.unknown() })
      .passthrough()
      .parse(await json(join(i.directory, 'certificate.json')));
    const { certificateOptionsSchema } =
      await import('./certificate-replacement.js');
    const options = certificateOptionsSchema.parse(saved.options);
    if (
      options.journalParent !== i.parent ||
      options.installationId !== c.plan.config.installationId ||
      options.keyPath !== join(c.root, 'runtime', 'tls', 'key.pem') ||
      options.certPath !== join(c.root, 'runtime', 'tls', 'cert.pem') ||
      options.operationId !== i.operationId ||
      options.origin !== c.config.APP_ORIGIN
    )
      throw new LifecycleError('INPUT_INVALID');
    const windows = {
      ...(await service(c, i.operationId, c.state.appRoot, c.state.appRoot)),
      certificateKeyPath: options.keyPath,
      certificateCertPath: options.certPath,
    };
    const host = createWindowsCertificateService(windows, await scriptTrust(), {
      runtimeConnectionString: c.config.DATABASE_URL,
      installationId: c.plan.config.installationId,
    });
    return {
      ...i,
      options,
      host,
      inspection: await inspectCertificateReplacement(options, host),
    };
  }
  const u = await updateRecovery(c, i);
  return { ...i, inspection: await inspectFailedUpdate(u.options) };
}

// Preview is read-only. Its digest binds the full inputs and inspected state,
// never just an installation UUID or a previous successful eligibility check.
export async function prepareLifecycle(input: unknown) {
  const request = lifecycleRequestSchema.parse(input);
  if (request.action === 'install') {
    await publisherTrust(request.configuration.releaseTrustFile);
    const plan = await prepareOfflineInstallation(request.configuration);
    return {
      request,
      selected: plan as unknown,
      binding: null,
      approval: digest(plan),
      summary: {
        installationId: plan.config.installationId,
        root: plan.config.root,
        origin: plan.config.origin,
        version: plan.version,
        effect:
          'Create a new dedicated installation. Existing roots are refused.',
      },
    };
  }
  const c = await context(request.root);
  const summary: Record<string, unknown> = {
    installationId: c.plan.config.installationId,
    root: c.root,
    origin: c.config.APP_ORIGIN,
    version: c.state.version,
  };
  let selected: unknown = null;
  if (!['status', 'inspect', 'recover'].includes(request.action))
    await noMaintenance(c.root);
  if (request.action === 'license') {
    const envelope = await json(request.file, 16384);
    const claims = verifyEntitlement(envelope, c.trust);
    if (
      claims.edition !== 'offline' ||
      claims.installationId !== c.plan.config.installationId
    )
      throw new LifecycleError('INPUT_INVALID');
    selected = envelope;
    summary.license = claims;
  } else if (request.action === 'repair') {
    await publisherTrust(request.configuration.releaseTrustFile);
    selected = await prepareOfflineRepair(c.root, request.configuration);
    summary.effect =
      'Repair the exact installed release. Keep the existing database, accounts and keys.';
  } else if (request.action === 'update') {
    if (within(c.root, request.bundleRoot))
      throw new LifecycleError('INPUT_INVALID');
    await assertPrivateDirectory(dirname(request.releaseTrustFile));
    const trust = await publisherTrust(request.releaseTrustFile);
    const outer = await verifyOfflineRelease(request.bundleRoot, trust);
    const release = await verifyOfflineRelease(
      join(request.bundleRoot, 'app'),
      trust,
    );
    if (
      outer.version !== release.version ||
      outer.toSchemaDigest !== release.toSchemaDigest ||
      release.toSchemaDigest !== (await migrationDigest())
    )
      throw new LifecycleError('INPUT_INVALID');
    const { assertReleaseCompatibility } = await import('./release-package.js');
    assertReleaseCompatibility(release, {
      version: c.state.version,
      schemaDigest: c.state.schemaDigest,
    });
    const db = createDatabase(c.connectionString);
    try {
      summary.maintenance = await checkOfflineUpdateEligibility(
        db,
        c.trust,
        c.plan.config.installationId,
      );
    } finally {
      await db.close();
    }
    selected = {
      outer,
      release,
      trust: certificateHash(
        await readCertificateOperationFile(request.releaseTrustFile, 32768),
      ),
    };
    summary.targetVersion = release.version;
    summary.effect =
      'Stop billing, verify a new backup, update a separate database copy, validate and reopen billing.';
  } else if (request.action === 'certificate') {
    const options = await certificateOptions(
      c,
      request,
      '00000000-0000-4000-8000-000000000001',
    );
    selected = {
      options,
      key: await inputHash(request.keyFile, 65536),
      certificate: certificateHash(
        await readCertificateOperationFile(request.certFile, 262144),
      ),
    };
    summary.effect =
      'Replace the HTTPS certificate during maintenance using the supplied approved CA.';
  } else if (request.action === 'inspect' || request.action === 'recover') {
    const i = await inspect(c);
    selected = {
      kind: i.kind,
      operationId: i.operationId,
      inspection: i.inspection,
    };
    summary.interrupted = selected;
    summary.effect =
      request.action === 'inspect'
        ? 'Read the saved operation and current state.'
        : 'Finish the saved repair/uninstall, or restore the selected certificate / original update recovery point. Later writes can be lost by update rollback.';
  } else if (request.action === 'backup')
    summary.effect =
      'Create an encrypted backup and restore it into an isolated verification database.';
  else if (request.action === 'uninstall')
    summary.effect =
      'Remove only verified service, task and firewall registrations. Retain the database, files, accounts, backups, keys and recovery records.';
  else {
    summary.host = JSON.parse(
      await launchLifecycleHelper('Invoke-LifecycleBackup.ps1', [
        '-Root',
        c.root,
        '-Action',
        'Check',
      ]),
    ) as unknown;
    summary.effect =
      'Current local service/task ownership and HTTPS readiness observations. Separate-client LAN acceptance is still required.';
  }
  return {
    request,
    selected,
    binding: c.binding,
    summary,
    approval: digest({ request, binding: c.binding, selected }),
  };
}

export async function executeLifecycle(
  input: unknown,
  approval: string,
  progress: (phase: string) => void = () => {},
) {
  hash.parse(approval);
  progress('checking');
  const prepared = await prepareLifecycle(input);
  if (prepared.approval !== approval)
    throw new LifecycleError('TARGET_CHANGED');
  const request = prepared.request;
  if (request.action === 'install') {
    progress('installing');
    await installOffline(offlinePlanSchema.parse(prepared.selected));
    return {
      state: 'installed',
      installationId: request.configuration.installationId,
    };
  }
  const c = await context(request.root);
  if (c.binding !== prepared.binding)
    throw new LifecycleError('TARGET_CHANGED');
  if (['status', 'inspect'].includes(request.action)) return prepared.summary;
  progress(request.action);
  if (request.action === 'license') {
    const db = createDatabase(c.connectionString);
    try {
      return await installEntitlement(db, c.config, c.trust, prepared.selected);
    } finally {
      await db.close();
    }
  }
  if (request.action === 'backup') {
    return JSON.parse(
      await launchLifecycleHelper('Invoke-LifecycleBackup.ps1', [
        '-Root',
        c.root,
      ]),
    ) as unknown;
  }
  if (request.action === 'repair' || request.action === 'uninstall') {
    const repair =
      request.action === 'repair'
        ? await prepareOfflineRepair(c.root, request.configuration)
        : undefined;
    if (
      request.action === 'repair' &&
      digest(repair) !== digest(prepared.selected)
    )
      throw new LifecycleError('TARGET_CHANGED');
    const host = await createOfflineNativeHost(c.plan, c.fingerprints, repair);
    return runOfflineMaintenance(
      {
        parent: join(c.root, 'operations'),
        installationId: c.plan.config.installationId,
        version: c.state.version,
        binding: digest({ retained: c.binding, repair }),
        ...(repair ? { repairConfiguration: repair.config } : {}),
      },
      request.action,
      host,
    );
  }
  if (request.action === 'certificate') {
    const operationId = randomUUID();
    const options = await certificateOptions(c, request, operationId);
    const host = createWindowsCertificateService(
      {
        ...(await service(c, operationId, c.state.appRoot, c.state.appRoot)),
        certificateKeyPath: options.keyPath,
        certificateCertPath: options.certPath,
      },
      await scriptTrust(),
      {
        runtimeConnectionString: c.config.DATABASE_URL,
        installationId: c.plan.config.installationId,
      },
    );
    return replaceCertificate(
      options,
      {
        keyPath: request.keyFile,
        certPath: request.certFile,
        expected: z
          .object({ key: hash, certificate: hash })
          .passthrough()
          .parse(prepared.selected),
      },
      host,
      { installationId: c.plan.config.installationId, maintenance: true },
    );
  }
  if (request.action === 'recover') {
    const i = await inspect(c);
    if (
      digest({
        kind: i.kind,
        operationId: i.operationId,
        inspection: i.inspection,
      }) !== digest(prepared.selected)
    )
      throw new LifecycleError('TARGET_CHANGED');
    if (i.kind === 'repair' || i.kind === 'uninstall') {
      const m = await maintenance(c, i.operationId);
      const inspection = z
        .object({ fingerprint: hash })
        .passthrough()
        .parse(i.inspection);
      return recoverOfflineMaintenance(m.options, i.operationId, m.host, {
        installationId: c.plan.config.installationId,
        operatorStopped: request.operatorStopped,
        expectedFingerprint: inspection.fingerprint,
      });
    }
    if ('options' in i && 'host' in i && i.options && i.host) {
      if (!request.selection) throw new LifecycleError('INPUT_INVALID');
      const checked = z
        .object({ active: z.object({ key: hash, cert: hash }).strict() })
        .passthrough()
        .parse(i.inspection);
      return recoverCertificateReplacement(
        i.options,
        request.selection,
        checked.active,
        i.host,
        {
          installationId: c.plan.config.installationId,
          maintenance: true,
          operatorStopped: true,
        },
      );
    }
    const u = await updateRecovery(c, i);
    return recoverFailedUpdate(u.options, u.service, {
      installationId: c.plan.config.installationId,
      updaterStopped: true,
      acceptRecoveryPoint: true,
    });
  }
  if (request.action === 'update') {
    const trust = await publisherTrust(request.releaseTrustFile);
    const installed = {
      version: c.state.version,
      schemaDigest: c.state.schemaDigest,
    };
    const staged = await stageReleasePackage(
      join(request.bundleRoot, 'app'),
      join(c.root, 'releases'),
      trust,
      installed,
    );
    const reviewed = z
      .object({ release: z.unknown() })
      .passthrough()
      .parse(prepared.selected);
    if (
      digest(await verifyOfflineRelease(staged.directory, trust)) !==
      digest(reviewed.release)
    )
      throw new LifecycleError('TARGET_CHANGED');
    const operationId = randomUUID();
    const options = await backupOptions(c);
    try {
      const windows = await service(
        c,
        operationId,
        c.state.appRoot,
        staged.directory,
      );
      const host = createWindowsUpdateHost({
        operationId,
        installationId: c.plan.config.installationId,
        journalParent: join(c.root, 'operations'),
        installedRoot: c.state.appRoot,
        stagedRoot: staged.directory,
        installed,
        backup: options,
        runtimeConnectionString: c.config.DATABASE_URL,
        entitlementTrust: c.trust,
        releaseTrust: trust,
        service: { ...windows, scripts: await scriptTrust() },
      });
      const originalAcquire = host.acquire.bind(host);
      host.acquire = async () => {
        const lease = await originalAcquire();
        try {
          const file = await open(
            join(
              c.root,
              'operations',
              'gst-update-' + operationId,
              'launcher-update.json',
            ),
            'wx',
            0o600,
          );
          try {
            await file.writeFile(
              JSON.stringify({
                installedRoot: c.state.appRoot,
                stagedRoot: staged.directory,
                installed,
                releaseTrustFile: request.releaseTrustFile,
              }) + '\n',
            );
            await file.sync();
          } finally {
            await file.close();
          }
          return lease;
        } catch (error) {
          await lease.release();
          throw error;
        }
      };
      const record = host.record.bind(host);
      host.record = async (value) => {
        await record(value);
        progress(value.phase);
      };
      return await runAssistedUpdate({
        operationId,
        installationId: c.plan.config.installationId,
        stagedRoot: staged.directory,
        releaseTrust: trust,
        installed,
        host,
      });
    } finally {
      options.key.fill(0);
    }
  }
  throw new LifecycleError('INPUT_INVALID');
}

// Safe native helper invocation: no caller-selected script or inherited Node options.
async function launchLifecycleHelper(
  scriptName: 'Invoke-LifecycleBackup.ps1',
  args: string[],
) {
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const script = join(scriptDirectory, scriptName);
  await assertPrivateDirectory(scriptDirectory);
  await readCertificateOperationFile(script, 16384);
  return new Promise<string>((resolve, reject) => {
    execFile(
      join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-File', script, ...args],
      {
        windowsHide: true,
        maxBuffer: 16384,
        env: {
          SystemRoot: system,
          WINDIR: system,
          PATH: join(system, 'System32'),
        },
      },
      (error, stdout) =>
        error
          ? reject(new LifecycleError('OPERATION_FAILED'))
          : resolve(stdout.trim()),
    );
  });
}
