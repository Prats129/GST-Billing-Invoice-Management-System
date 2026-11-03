# Offline Windows feasibility prototype

Runbook and verification status: [docs/windows-offline-spike.md](../../docs/windows-offline-spike.md).

Read-only host/client observations and the required VM matrix:
[Windows deployment checks](../../docs/windows-deployment-checks.md).
Run their safe decision tests without a service, CA or LAN host:

```powershell
powershell -NoProfile -File apps/windows-installer/scripts/Test-DeploymentChecks.ps1
```

This directory contains operator-run PowerShell deployment prototypes and backup jobs/scheduling, **not a production installer**. Scripts never download executables, silently install certificate trust, expose PostgreSQL, or delete customer data. Read the runbook before executing privileged deployment steps on a disposable Windows VM.

The [assisted-update core and journal](../../docs/assisted-updates.md) implement
testable sequencing and interruption handling. Their native Windows adapter and
production installer entrypoint are still unfinished; there is no new installer
command to run on this laptop.

Backup key creation, job scheduling and health monitoring are documented in
[backup recovery](../../docs/backup-recovery.md). Test the task definition without
registering or running a background task:

```powershell
powershell -NoProfile -File apps/windows-installer/scripts/Test-BackupSchedule.ps1
```

Safe syntax check from the repository root:

```powershell
powershell -NoProfile -File apps/windows-installer/scripts/Test-SpikeScripts.ps1
```
