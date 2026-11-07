# Guided local development setup

This host-run assistant prepares a **new local development profile**. It is not
an installer, production deployment tool or a way to adopt/repair existing
databases. Existing commands and root environment files remain unchanged.

## First run

Have the intended local PostgreSQL server running and know its administrator
login/password. For the repository's existing Docker database, the login is
normally `gst_dev`; for a separate PostgreSQL installation it may be `postgres`.
These are database accounts, not your Billing or Platform Admin login. Setup
does not start/stop unrelated services, delete volumes or reset passwords.

From the project root in an interactive PowerShell terminal:

```powershell
& ./scripts/Setup-Project.ps1
```

On Windows, when the pinned Node/pnpm versions are already active, the equivalent
shortcut is `pnpm setup:prepare`. If pnpm refuses to run because of engine
versions, use the direct PowerShell command above so it can select the toolchain
first. The shortcut honors the existing PowerShell execution policy.

The launcher selects the existing pinned toolchain, installs frozen dependencies,
builds shared packages, then opens the assistant. It does not download a new
toolchain or change the lockfile. Use `-SkipInstall` only when dependencies are
already installed; shared packages are still built. If prepared already, run
`pnpm setup:guided` directly.

The assistant:

1. Checks native password hashing and asks whether to create or resume a profile.
2. Asks for the edition, a unique profile name and local PostgreSQL connection.
   Passwords are hidden; no password arguments or hand-written JSON are needed.
3. Shows database names, role names and the private folder before confirmation.
4. Creates only approved new resources, applies reviewed migrations and the
   existing runtime/operator permission policies.
5. Creates the initial owner with recovery proof saved durably beforehand, or
   reconciles that same owner's committed creation after an interruption.
6. Verifies runtime connections and optionally launches an existing dev command.

Choose **offline** for a local Billing workspace and organization owner. Choose
**saas** for separate Billing/Platform databases and a platform owner. Create SaaS
customer organizations and owner setup links in Platform Admin afterwards. This
never promotes customer owners into platform administration.

Use a new lowercase name, such as `gst_local`. Database names are derived from it
(`gst_local_billing`, and `gst_local_platform` for SaaS), with separate migration,
runtime and restricted operator roles. Existing names without matching setup
evidence cause a stop; they are never adopted or overwritten. The administrator
password is not saved, and its connection closes before development servers start.

## Protected settings and recovery

Windows profiles are stored under
`%LOCALAPPDATA%\.gst-development\<profile-name>`; other systems use
`~/.gst-development`. The folder is protected before secrets are written, and
ancestors must pass the existing private-directory checks. Unsafe permissions
block setup; security checks are never weakened to accommodate them.

- `profile.json` contains generated credentials, encryption keys, installation
  identity and prepared host recovery proof. Treat it as private recovery material.
- `billing.env` / `admin.env` contain separate runtime settings without migration
  credentials. Offline profiles do not create an admin runtime file.
- `operator.env` contains migration credentials for host tools only.
- Identity receipts, `progress.jsonl` and `complete.json` preserve progress.
  Owner and host administrator passwords are never written to these files.

Protect and back up the folder separately from the databases. ACL protection is
not encryption; follow protected storage/backup custody procedures. Do not attach
the folder to support requests or include it in customer distributions. Signing
keys and the publisher register are not created, copied or loaded by setup.

Existing files are never overwritten. Reruns compare identities/content and stop
on conflicts. Do not edit identities or copy profiles to replacement servers to
force a retry. Root `.env`, `.env.admin` and `.env.admin.operator`, including their
comments and unknown settings, are preserved unchanged.

## Returning later

For daily startup:

```powershell
& ./scripts/Use-ProjectToolchain.ps1
pnpm setup:launch
```

Select the protected profile folder, then Billing or Admin. This needs no database
administrator password and performs no migrations, provisioning or worker enable.
Use a second terminal for the other app pair. Open the exact `127.0.0.1` URL
printed by Vite; mixing it with `localhost` can fail exact Origin checks.

For **interrupted setup**, run `pnpm setup:guided` and choose **resume** with the
same profile folder and intended database administrator. An empty owner password
is allowed only when an owner is already committed; creating a new owner still
requires a valid password. Completed reruns preserve accounts, passwords, settings
and host-managed worker disables.

Plain `pnpm dev` / `pnpm dev:admin` still use their normal configuration. Guided
launch selects a profile for its child process only; it never rewrites system or
user environment variables. Operator credentials are excluded from app launches.

To inspect this profile instead of the existing root configuration:

```powershell
pnpm setup:check --profile "C:\path\to\the\private-profile"
```

This reads the selected runtime files without printing private values or
connecting to PostgreSQL. An offline profile checks Billing only. Without
`--profile`, `setup:check` retains the existing root configuration behavior.

## Initial SaaS processing

Processing starts disabled. Setup offers a separate explicit enable step for an
unused, identity-verified **new** SaaS installation. It verifies there is no
organization/license/operation history and saves an approval receipt. Once saved,
rerunning setup never removes a later host-managed disable.

Existing/restored history needs the
[host reconciliation procedure](platform-admin.md#connecting-a-saas-deployment).
Setup cannot prove publisher-register reconciliation or authorize a restored
history using an old flag/file. MFA, RBAC, signed license requirements and tax
restrictions remain intact.

## Failure handling

| Failure                                              | Action                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Wrong tools/dependencies                             | Select the pinned toolchain and rerun preparation with the frozen lockfile.                                                       |
| PostgreSQL unavailable/login rejected                | Check the intended local server/container and database administrator credentials. Never reset volumes or passwords automatically. |
| `LOCAL_DATABASE_ADMIN_REQUIRED`                      | Use temporary local host database authority. Runtime credentials are deliberately insufficient.                                   |
| `EXISTING_RESOURCE_CONFLICT`                         | Choose a different new name or have the host operator inspect the exact collision; do not delete or adopt existing resources.     |
| Cluster, role or database identity mismatch          | Stop. Check host/port and the recovery procedure. Missing/replaced identities are not recreated.                                  |
| File/content/ACL conflict                            | Inspect the private folder. Setup does not overwrite settings or silently repair existing permissions.                            |
| `SETUP_BUSY`                                         | Wait for the active setup session. Its PostgreSQL lock releases on disconnect; no age-based lock stealing is used.                |
| Crash between database creation and its identity tag | Preserve everything for host inspection. Setup refuses the ambiguous database instead of adopting it by name.                     |
| Owner conflict                                       | Verify account/recovery evidence. Setup never resets passwords, ownership or MFA.                                                 |
| `FULL_RECONCILIATION_REQUIRED`                       | Use the host reconciliation runbook; the initial enable shortcut is unavailable.                                                  |

Failures retain prepared recovery material and progress. There is no automatic
rollback that drops databases, users or keys. Private database errors/connection
strings are not echoed. Existing technical CLIs remain available for reviewed
host procedures; none are exposed as a web terminal.

## Verification boundary

Tests use disposable databases/roles and newly created private folders. They
exercise fresh setup, role restrictions, interrupted owner creation, concurrency,
collisions, changed identities and reruns. This does not establish physical power
loss durability, real Windows installer/reboot/LAN behavior, production hosting
or signing acceptance. Those remain existing release requirements/later batches.
