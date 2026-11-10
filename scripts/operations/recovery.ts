import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Client } from '../../apps/admin-api/src/store.js';
import { provisionRecoveryRuntime } from '../../packages/database/src/runtime-access.js';
import {
  switchRecovery,
  recoverySwitchStatus,
} from '../../packages/database/src/recovery-switch.js';
import {
  loadBackupProfile,
  targetEnvironment,
  connectionUrl,
  readPrivateJson,
} from './profiles.js';
import type { BackupTarget } from './profiles.js';
import { inspectJobs, withTarget } from './runner.js';
import { saveNewFile } from '../setup/workflow.js';
import { platformBackupAdapter } from './platform.js';

export async function selectedRecovery(
  directory: string,
  targetId: string,
  jobId: string,
) {
  const profile = await loadBackupProfile(directory),
    target = profile.targets.find((item) => item.id === targetId);
  const job = (await inspectJobs(directory, targetId)).find(
    (item) => item.id === jobId,
  );
  if (
    !target ||
    job?.action !== 'recover' ||
    job.result?.state !== 'completed' ||
    !job.result.recoveryDatabase
  )
    throw new Error('CONFIRMED_RECOVERY_JOB_REQUIRED');
  return { target, job, candidate: job.result.recoveryDatabase };
}
export async function billingRecoveryAction(
  directory: string,
  targetId: string,
  jobId: string,
  action: 'runtime-grants' | 'status' | 'activate' | 'rollback',
  runtimeUrl: string,
  confirmWritersStopped = false,
  confirmRollbackDataLoss = false,
) {
  const { target, candidate } = await selectedRecovery(
    directory,
    targetId,
    jobId,
  );
  if (target.kind !== 'billing') throw new Error('BILLING_RECOVERY_REQUIRED');
  const env = await targetEnvironment(target),
    connectionString = connectionUrl(target, env);
  // A post-cutover OID change deliberately invalidates the backup profile. Switch
  // status/rollback use the existing engine's own identity/audit checks instead.
  if (action === 'runtime-grants' || action === 'activate')
    await withTarget(target, async () => {});
  const url = new URL(runtimeUrl),
    source = new URL(connectionString);
  if (
    url.hostname !== source.hostname ||
    url.port !== source.port ||
    url.pathname !== source.pathname ||
    url.search ||
    url.hash
  )
    throw new Error('RUNTIME_CONNECTION_MISMATCH');
  const options = {
    connectionString,
    runtimeConnectionString: runtimeUrl,
    recoveryDatabase: candidate,
    confirmActiveDatabase: target.expectedDatabase,
    installationId: target.installationId,
    confirmWritersStopped,
    confirmRollbackDataLoss,
  };
  const id = randomUUID();
  await saveNewFile(
    directory,
    'switch-' + id + '.json',
    JSON.stringify({
      target: target.id,
      jobId,
      action,
      startedAt: new Date().toISOString(),
      candidate,
    }) + '\n',
  );
  const result =
    action === 'runtime-grants'
      ? await provisionRecoveryRuntime({
          connectionString,
          database: candidate,
          confirmDatabase: candidate,
          installationId: target.installationId,
          runtimeRole: decodeURIComponent(url.username),
        })
      : action === 'status'
        ? await recoverySwitchStatus(options)
        : await switchRecovery(options, action);
  await saveNewFile(
    directory,
    'switch-result-' + id + '.json',
    JSON.stringify({ completedAt: new Date().toISOString(), result }) + '\n',
  );
  return result;
}

async function inspectPlatformCandidate<T>(
  target: BackupTarget,
  candidate: string,
  inspect: (db: Client) => Promise<T>,
) {
  if (!/^gst_platform_recovery_[a-f0-9]{32}$/.test(candidate))
    throw new Error('PLATFORM_CANDIDATE_REQUIRED');
  return withTarget(target, async (_source, options) => {
    const url = new URL(options.connectionString);
    url.pathname = '/postgres';
    const admin = new Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5000,
      statement_timeout: 60000,
    });
    let opened = false;
    try {
      await admin.connect();
      const result = await admin.query(
        'SELECT oid::int AS oid,datallowconn,datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_database WHERE datname=$1',
        [candidate],
      );
      const row = result.rows[0];
      if (!row || row.datallowconn || !row.owned)
        throw new Error('QUARANTINED_OWNED_CANDIDATE_REQUIRED');
      const lock = await admin.query(
        'SELECT pg_try_advisory_lock(73492642,$1::int) AS locked',
        [row.oid],
      );
      if (!lock.rows[0]?.locked) throw new Error('RECOVERY_ALREADY_RUNNING');
      // Confirm PUBLIC cannot connect; restoration does not import role grants.
      const allowed = await admin.query(
        "SELECT EXISTS(SELECT 1 FROM pg_database d,LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee=0 AND a.privilege_type='CONNECT') AS unsafe",
        [candidate],
      );
      if (allowed.rows[0]?.unsafe)
        throw new Error('UNSAFE_RECOVERY_PRIVILEGES');
      await admin.query(`ALTER DATABASE "${candidate}" ALLOW_CONNECTIONS true`);
      opened = true;
      url.pathname = '/' + candidate;
      const db = new Client({
        connectionString: url.toString(),
        connectionTimeoutMillis: 5000,
        statement_timeout: 60000,
      });
      try {
        await db.connect();
        await (await platformBackupAdapter()).validate(db);
        const marker = await db.query(
          "SELECT metadata FROM platform_audit WHERE action='recovery.prepared' ORDER BY id DESC LIMIT 1",
        );
        const control = await db.query(
          'SELECT operations_enabled FROM platform_control',
        );
        if (
          marker.rows[0]?.metadata?.installationId !== target.installationId ||
          control.rows[0]?.operations_enabled !== false
        )
          throw new Error('PLATFORM_RECOVERY_NOT_QUARANTINED');
        return await inspect(db);
      } finally {
        await db.end();
      }
    } finally {
      try {
        if (opened)
          await admin.query(
            `ALTER DATABASE "${candidate}" ALLOW_CONNECTIONS false`,
          );
      } finally {
        await admin.end();
      }
    }
  });
}

// This report is read-only. It never replays an operation, edits either ledger,
// enables authority or tries to repair a publisher register from portal history.
export async function reconcilePlatformRecovery(
  directory: string,
  targetId: string,
  jobId: string,
) {
  const { target, candidate } = await selectedRecovery(
    directory,
    targetId,
    jobId,
  );
  if (target.kind !== 'platform') throw new Error('PLATFORM_RECOVERY_REQUIRED');
  const profile = await loadBackupProfile(directory),
    billing = profile.targets.find((item) => item.kind === 'billing');
  const discrepancies: { id: string; reason: string }[] = [];
  const report = await inspectPlatformCandidate(
    target,
    candidate,
    async (platform) => {
      await platform.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const ops = await platform.query<{
        id: string;
        kind: string;
        payload: unknown;
        result: unknown;
        state: string;
      }>(
        'SELECT id,kind,payload,result,state FROM platform_operations ORDER BY id LIMIT 5001',
      );
      if (ops.rows.length > 5000)
        throw new Error('RECONCILIATION_LIMIT_REQUIRES_OPERATOR_REVIEW');
      let billingChecked = false,
        receiptCount = 0;
      if (billing)
        await withTarget(billing, async (db) => {
          await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          const receipts = await db.query<{
            id: string;
            kind: string;
            payload: unknown;
            result: unknown;
          }>(
            'SELECT id,kind,payload,result FROM platform_operator.receipts ORDER BY id LIMIT 5001',
          );
          if (receipts.rows.length > 5000)
            throw new Error('RECONCILIATION_LIMIT_REQUIRES_OPERATOR_REVIEW');
          receiptCount = receipts.rows.length;
          const portal = new Map(
            ops.rows.map((operation) => [operation.id, operation]),
          );
          const live = new Map(
            receipts.rows.map((receipt) => [receipt.id, receipt]),
          );
          for (const receipt of receipts.rows) {
            const operation = portal.get(receipt.id);
            if (!operation)
              discrepancies.push({
                id: receipt.id,
                reason: 'SAAS_RECEIPT_MISSING_FROM_RESTORED_PLATFORM',
              });
            else if (
              operation.kind !== receipt.kind ||
              !isDeepStrictEqual(operation.payload, receipt.payload)
            )
              discrepancies.push({
                id: receipt.id,
                reason: 'RECEIPT_PAYLOAD_CONFLICT',
              });
            else if (
              operation.state !== 'completed' ||
              !isDeepStrictEqual(operation.result, receipt.result)
            )
              discrepancies.push({
                id: receipt.id,
                reason: 'COMMITTED_RECEIPT_NEEDS_RECONCILIATION',
              });
          }
          for (const operation of ops.rows)
            if (operation.state === 'completed' && !live.has(operation.id))
              discrepancies.push({
                id: operation.id,
                reason: 'COMPLETED_OPERATION_HAS_NO_SAAS_RECEIPT',
              });
          const orgs = await platform.query<{ id: string; runtime_id: string }>(
            "SELECT id,runtime_id FROM platform_organizations WHERE edition='saas' ORDER BY id LIMIT 5001",
          );
          if (orgs.rows.length > 5000)
            throw new Error('RECONCILIATION_LIMIT_REQUIRES_OPERATOR_REVIEW');
          for (const org of orgs.rows) {
            const current = await db.query(
              'SELECT platform_operator.lookup($1::uuid) AS value',
              [org.runtime_id],
            );
            const observed = current.rows[0]?.value;
            if (!observed)
              discrepancies.push({
                id: org.id,
                reason: 'HOSTED_ORGANIZATION_NOT_FOUND',
              });
            else if (observed.entitlement) {
              const grants = await platform.query(
                'SELECT 1 FROM platform_grants WHERE organization_id=$1 AND envelope=$2::jsonb',
                [org.id, JSON.stringify(observed.entitlement)],
              );
              if (!grants.rows.length)
                discrepancies.push({
                  id: org.id,
                  reason: 'HOSTED_GRANT_NOT_IN_RESTORED_HISTORY',
                });
            }
          }
          await db.query('COMMIT');
          billingChecked = true;
        });
      const offline = await platform.query(
        "SELECT count(*)::int AS count FROM platform_organizations WHERE edition='offline'",
      );
      await platform.query('COMMIT');
      return {
        id: randomUUID(),
        target: target.id,
        jobId,
        candidate,
        checkedAt: new Date().toISOString(),
        billingChecked,
        receiptCount,
        operationCount: ops.rows.length,
        discrepancies,
        offlineOrganizations: offline.rows[0]?.count ?? 0,
        publisherRegisterReviewRequired: true,
        offlineDeliveryReviewRequired: true,
        operationsRemainDisabled: true,
      };
    },
  );
  await saveNewFile(
    directory,
    'reconciliation-' + report.id + '.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  return report;
}

export async function recoveryInventory(directory: string, targetId: string) {
  const profile = await loadBackupProfile(directory),
    target = profile.targets.find((item) => item.id === targetId);
  if (!target) throw new Error('UNKNOWN_BACKUP_TARGET');
  const databases = await withTarget(target, async (db) => {
    const result = await db.query<{
      name: string;
      oid: number;
      connectionsAllowed: boolean;
      marker: string | null;
    }>(
      `SELECT datname AS name,oid::int AS oid,datallowconn AS "connectionsAllowed",shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND datname~'^gst_(platform_)?(recovery|restore|previous)_[a-f0-9]{32}$' ORDER BY datname LIMIT 1001`,
    );
    if (result.rows.length > 1000) throw new Error('RECOVERY_INVENTORY_LIMIT');
    return result.rows
      .filter((row) => {
        try {
          const marker = JSON.parse(row.marker ?? 'null');
          return (
            marker?.format === 'gst-recovery-candidate' &&
            marker.installationId === target.installationId &&
            marker.domain === target.kind
          );
        } catch {
          return false;
        }
      })
      .map((row) => ({
        name: row.name,
        oid: row.oid,
        connectionsAllowed: row.connectionsAllowed,
      }));
  });
  const jobs = await inspectJobs(directory, targetId);
  const artifacts = [];
  for (const job of jobs) {
    let plan: unknown = null;
    if (job.action === 'recover') {
      try {
        plan = await readPrivateJson(
          join(directory, 'candidate-' + job.id + '.json'),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    artifacts.push({
      jobId: job.id,
      action: job.action,
      artifact: job.artifact,
      result: job.result,
      candidatePlan: plan,
    });
  }
  return {
    databases,
    artifacts,
    cleanup:
      'No automatic deletion. Preserve unresolved candidates, retained databases and plaintext crash workspaces for host inspection. Existing recovery-switch status identifies retained database OIDs.',
  };
}
