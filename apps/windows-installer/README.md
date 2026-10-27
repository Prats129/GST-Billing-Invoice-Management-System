# Offline Windows feasibility prototype

Runbook and verification status: [docs/windows-offline-spike.md](../../docs/windows-offline-spike.md).

This directory contains operator-run PowerShell prototypes, **not a production installer**. Scripts never download executables, silently install certificate trust, expose PostgreSQL, or delete customer data. Read the runbook before executing them on a disposable Windows VM.

Safe syntax check from the repository root:

```powershell
powershell -NoProfile -File apps/windows-installer/scripts/Test-SpikeScripts.ps1
```
