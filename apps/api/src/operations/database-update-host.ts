import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase } from '@gst/database';
import {
  createEncryptedBackup,
  verifyRestore,
  prepareRecovery,
  migrationDigest,
  provisionRecoveryRuntime,
  switchRecovery,
  recoverySwitchStatus,
  inspectUpdateDatabase,
  readUpdateOrganizations,
  updateConnections,
} from '@gst/database/operations';
import type { BackupOperatorOptions } from '@gst/database/operations';
import type { EntitlementTrust } from '../licensing/entitlement.js';
import { assertUpdateEligibility } from './update-eligibility.js';
import { acquireUpdateJournal } from './update-journal.js';
import type {
  UpdateHost,
  UpdateCandidate,
  UpdateBackup,
} from './assisted-update.js';
import type { ReleaseManifest } from './release-package.js';
import { verifyReleasePackage } from './release-package.js';
import {
  readInstallationState,
  replaceInstallationState,
} from './installation-state.js';
import type { InstallationState } from './installation-state.js';

export interface UpdateService {
  stop(): Promise<void>;
  selectRelease(): Promise<void>;
  startPrivate(): Promise<void>;
  assertReady(): Promise<void>;
  admit(): Promise<void>;
}

// These are real database operations; the separate native service adapter must
// implement ingress/job/service exclusion. No caller-selected recovery receipt
// is accepted in place of a candidate prepared in this operation.
export function createDatabaseUpdateHost(options: {
  operationId: string;
  installationId: string;
  journalParent: string;
  stagedRoot: string;
  installedRoot: string;
  installed: { version: string; schemaDigest: string };
  backup: BackupOperatorOptions;
  runtimeConnectionString: string;
  entitlementTrust: EntitlementTrust;
  releaseTrust: EntitlementTrust;
  service: UpdateService;
}): UpdateHost {
  const binding = updateConnections(
    options.backup.connectionString,
    options.runtimeConnectionString,
  );
  if (options.backup.installationId !== options.installationId)
    throw new Error('Installation mismatch.');
  let journal: Awaited<ReturnType<typeof acquireUpdateJournal>> | undefined;
  let backup: UpdateBackup | undefined;
  let candidate: UpdateCandidate | undefined;
  let manifest: ReleaseManifest | undefined;
  let stopped = false;
  let activated = false;
  let installedState: InstallationState | undefined;
  const inspect = <T>(
    fn: Parameters<typeof inspectUpdateDatabase<T>>[1],
    candidateName?: string,
    idle = false,
  ) =>
    inspectUpdateDatabase(
      {
        connectionString: options.backup.connectionString,
        runtimeConnectionString: options.runtimeConnectionString,
        idle,
        ...(candidateName ? { candidate: candidateName } : {}),
      },
      fn,
    );
  const save = async (name: string, value: unknown) => {
    if (!journal) throw new Error('Journal required.');
    const file = await open(
      join(journal.directory, name + '.json'),
      'wx',
      0o600,
    );
    try {
      await file.writeFile(JSON.stringify(value) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
  };
  const switchOptions = () => {
    if (!candidate || !stopped) throw new Error('Stopped candidate required.');
    return {
      connectionString: options.backup.connectionString,
      runtimeConnectionString: options.runtimeConnectionString,
      recoveryDatabase: candidate.reference,
      confirmActiveDatabase: binding.database,
      installationId: options.installationId,
      confirmWritersStopped: true,
    };
  };
  const maintenance = async (name?: string) =>
    inspect(async (db) => {
      const rows = await readUpdateOrganizations(db);
      assertUpdateEligibility(
        rows,
        options.entitlementTrust,
        options.installationId,
        new Date(),
      );
      return rows.map((row) => row.id);
    }, name);
  return {
    async acquire() {
      const target = await verifyReleasePackage(
        options.stagedRoot,
        options.releaseTrust,
        options.installed,
      );
      if (target.toSchemaDigest !== options.installed.schemaDigest)
        throw new Error('Schema-changing updates require a later adapter.');
      if (
        journal ||
        (await migrationDigest()) !== options.installed.schemaDigest
      ) {
        // This first bound adapter is deliberately schema-preserving. Forward
        // migration cutover needs a matching target updater/recovery release.
        throw new Error('Use the matching schema-preserving operator release.');
      }
      installedState = await readInstallationState(options.journalParent);
      if (
        installedState.installationId !== options.installationId ||
        installedState.version !== options.installed.version ||
        installedState.schemaDigest !== options.installed.schemaDigest ||
        installedState.appRoot !== options.installedRoot
      )
        throw new Error(
          'Protected installation state does not match the requested update.',
        );
      journal = await acquireUpdateJournal(
        options.journalParent,
        options.installationId,
        options.operationId,
      );
      try {
        if (
          JSON.stringify(await readInstallationState(options.journalParent)) !==
          JSON.stringify(installedState)
        )
          throw new Error('Installation changed during acquisition.');
      } catch (error) {
        await journal.release();
        journal = undefined;
        throw error;
      }
      return { release: () => journal!.release() };
    },
    async record(value) {
      if (!journal) throw new Error();
      await journal.record(value);
    },
    async assertMaintenance(value) {
      const ids = await maintenance();
      if (value) {
        if (!candidate || value.reference !== candidate.reference)
          throw new Error('Unknown candidate.');
        if (
          JSON.stringify(await maintenance(candidate.reference)) !==
          JSON.stringify(ids)
        )
          throw new Error('Candidate organization mismatch.');
      }
    },
    async stopWriters() {
      await options.service.stop();
      await inspect(
        async (_db, digest) => {
          if (digest !== options.installed.schemaDigest)
            throw new Error('Installed schema mismatch.');
        },
        undefined,
        true,
      );
      stopped = true;
    },
    async backupAndVerify() {
      if (!stopped || !journal || backup) throw new Error();
      const artifact = join(journal.directory, 'before-update.gstbackup');
      const created = await createEncryptedBackup(options.backup, artifact);
      const checked = await verifyRestore(options.backup, artifact);
      if (
        !checked.verified ||
        checked.schemaDigest !== options.installed.schemaDigest ||
        created.schemaDigest !== checked.schemaDigest
      )
        throw new Error('Backup mismatch.');
      backup = {
        reference: 'before-update',
        installationId: options.installationId,
        schemaDigest: checked.schemaDigest,
        verified: true,
      };
      await save('backup', {
        ...backup,
        artifact,
        createdAt: created.createdAt,
      });
      return backup;
    },
    async prepareCandidate(value, target) {
      if (
        !stopped ||
        !journal ||
        !backup ||
        value.reference !== backup.reference ||
        candidate
      )
        throw new Error();
      if (
        target.fromSchemaDigest !== options.installed.schemaDigest ||
        target.toSchemaDigest !== (await migrationDigest())
      )
        throw new Error(
          'Schema-changing updates are not supported by this adapter.',
        );
      manifest = structuredClone(target);
      const prepared = await prepareRecovery(
        options.backup,
        join(journal.directory, 'before-update.gstbackup'),
        options.installationId,
      );
      await save('prepared', prepared); // Name retained even if runtime provisioning fails.
      await provisionRecoveryRuntime({
        connectionString: options.backup.connectionString,
        database: prepared.recoveryDatabase,
        confirmDatabase: prepared.recoveryDatabase,
        installationId: options.installationId,
        runtimeRole: binding.role,
      });
      candidate = {
        reference: prepared.recoveryDatabase,
        installationId: options.installationId,
        schemaDigest: prepared.schemaDigest,
        quarantined: true,
        runtimeAccessVerified: true,
      };
      await save('candidate', candidate);
      return candidate;
    },
    async activate(value) {
      if (
        !candidate ||
        value.reference !== candidate.reference ||
        activated ||
        !manifest
      )
        throw new Error();
      await inspect(async () => {}, undefined, true);
      const before = await recoverySwitchStatus(switchOptions());
      await save('cutover-intent', {
        ...before,
        installedRoot: options.installedRoot,
        stagedRoot: options.stagedRoot,
        installedVersion: options.installed.version,
        targetVersion: manifest.version,
      });
      const result = await switchRecovery(switchOptions(), 'activate');
      await save('cutover-result', result);
      activated = true;
      await options.service.selectRelease();
    },
    async startCandidate() {
      if (!activated) throw new Error();
      await options.service.startPrivate();
    },
    async assertReady(target) {
      if (!activated || !manifest || target.version !== manifest.version)
        throw new Error();
      const runtime = createDatabase(options.runtimeConnectionString);
      try {
        await runtime.ready();
      } finally {
        await runtime.close();
      }
      await inspect(async (_db, digest) => {
        if (digest !== target.toSchemaDigest)
          throw new Error('Active schema mismatch.');
      });
      await options.service.assertReady();
    },
    async admitUsers() {
      if (!activated || !installedState || !manifest) throw new Error();
      const replacement: InstallationState = {
        ...installedState,
        version: manifest.version,
        appRoot: options.stagedRoot,
        schemaDigest: manifest.toSchemaDigest,
        operationId: options.operationId,
      };
      await save('installed-state-intent', {
        before: installedState,
        after: replacement,
      });
      await replaceInstallationState(
        options.journalParent,
        installedState,
        replacement,
      );
      await options.service.admit();
      stopped = false;
    },
    async keepStopped() {
      await options.service.stop();
      stopped = true;
    },
  };
}
