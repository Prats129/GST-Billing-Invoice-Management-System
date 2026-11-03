# Offline Windows operator tools

Initial signed-bundle installation and data-preserving uninstall now have an
operator entrypoint: [installation workflow](../../docs/windows-installation.md).
Approved vendor artifacts, distribution signing and native acceptance are still
required. Do not run privileged deployment on the development laptop.

Runbook and verification status: [docs/windows-offline-spike.md](../../docs/windows-offline-spike.md).

Read-only host/client observations and the required VM matrix:
[Windows deployment checks](../../docs/windows-deployment-checks.md).
Run their safe decision tests without a service, CA or LAN host:

```powershell
powershell -NoProfile -File apps/windows-installer/scripts/Test-DeploymentChecks.ps1
```

This directory contains operator-run deployment code, prototypes and backup jobs/scheduling, **not an approved commercial installer release**. Scripts never download executables, silently install certificate trust, expose PostgreSQL, or delete customer data. Read the runbook before executing privileged deployment steps on a disposable Windows VM.

The [assisted-update core and journal](../../docs/assisted-updates.md) implement
testable sequencing and interruption handling. A schema-preserving adapter now
binds real database recovery and Windows service/file operations for an already
provisioned dedicated service. The initial lifecycle command is documented above;
explicit retained-data repair/reinstallation and interrupted-operation recovery
are also implemented. Native acceptance remains unfinished.

Safe service-backend decision tests (all machine/network actions mocked):

```powershell
powershell -NoProfile -File apps/windows-installer/scripts/Test-UpdateService.ps1
```

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
