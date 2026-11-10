import type { BackupStatusResponse } from '@gst/contracts';
const guidance = {
  verified:
    'The last published report confirmed an unchanged archive and a compatible successful restore drill.',
  missing:
    'No completed restore drill is recorded. Ask the host operator to run a verified backup.',
  failed:
    'The latest attempt failed. Ask the host operator to inspect its saved job and resolve the cause.',
  interrupted:
    'A job has no confirmed completion. It may still be running or was interrupted. Inspect its archive/candidate before retrying; do not assume nothing committed.',
  stale:
    'The backup or its published report is too old for the configured policy. Ask the host operator to run and publish a fresh check.',
  artifact_missing:
    'The reported archive is missing or unsafe. Locate the protected original/off-device copy and verify it.',
  artifact_changed:
    'The archive no longer matches its successful drill. Preserve it for inspection; verify an original recovery copy.',
  incompatible:
    'The drill used a different schema. Verify with the matching trusted release before considering recovery.',
};
const failureHelp = {
  TOOLS_FAILED: 'Check approved PostgreSQL 18 tools and tool access.',
  ARCHIVE_REJECTED:
    'Check the original key, installation identity, archive integrity and matching release schema.',
  DATABASE_UNAVAILABLE:
    'Check PostgreSQL availability and the protected operator connection.',
  STORAGE_FULL:
    'Free space on the approved archive/work storage without deleting required recovery evidence.',
  ACCESS_DENIED:
    'Check the host account and private file/directory permissions.',
  EXISTING_ARTIFACT:
    'Keep the existing file. Inspect the recorded outcome instead of overwriting it.',
  VERIFICATION_FAILED:
    'Inspect the saved job and candidate; verify schema and financial/history integrity before retrying.',
};
export function BackupStatus({
  value,
}: {
  value: BackupStatusResponse | null;
}) {
  return (
    <details className="card">
      <summary>Backup & recovery status</summary>
      <p>
        Host-reported protection for the shared server, not a customer download
        or live restore control. Use Refresh to reload the published report.
      </p>
      {!value || value.state !== 'reported' ? (
        <p>
          {value?.state === 'not_configured'
            ? 'The host has not connected a backup status report. Configure a protected profile with pnpm backup:guided, then publish its sanitized status.'
            : 'The backup report could not be read. Ask the host operator to inspect and republish it. This does not mean data is protected.'}
        </p>
      ) : (
        <>
          <p className="muted">
            Reported {new Date(value.report!.checkedAt).toLocaleString()}. The
            portal does not inspect archives or verify current off-device
            custody.
          </p>
          {value.report!.targets.map((target) => (
            <section className="operation" key={target.id}>
              <h3>
                {target.kind === 'billing'
                  ? 'Billing database'
                  : 'Platform Admin database'}{' '}
                · {target.id}
              </h3>
              <p>
                <strong>
                  {target.state === 'interrupted'
                    ? 'awaiting confirmation'
                    : target.state.replaceAll('_', ' ')}
                </strong>{' '}
                · {guidance[target.state]}
              </p>
              {target.lastErrorCode && (
                <p>{failureHelp[target.lastErrorCode]}</p>
              )}
              <p>
                Last attempt:{' '}
                {target.lastAttemptAt
                  ? new Date(target.lastAttemptAt).toLocaleString()
                  : 'none'}
                . Last successful restore drill:{' '}
                {target.lastVerifiedAt
                  ? new Date(target.lastVerifiedAt).toLocaleString()
                  : 'none'}
                . Maximum age: {target.maximumAgeHours} hours.
              </p>
            </section>
          ))}
        </>
      )}
      <p>
        Recovery prepares an isolated, quarantined copy. Only a host operator
        can review runtime grants, stop writers and approve cutover/rollback. A
        platform restore also requires SaaS/publisher-history reconciliation
        before processing resumes.
      </p>
    </details>
  );
}
