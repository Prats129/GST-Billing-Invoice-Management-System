# Initial offline installation and preserving uninstall

This is an operator-run installation workflow, with local verification recorded
in [review coverage](review-coverage.md). It is **not an approved commercial
installer release**. Do not run deployment commands on the development laptop.
Native service/ACL/firewall/Task Scheduler, clean install, reboot/LAN, power-loss
and retained-data repair/reinstallation acceptance require the postponed disposable
Windows host and separate client. No certificate trust is installed automatically.

## Required inputs

Use Windows 11 x64 with serviced .NET Framework 4.8 or newer and administrator
access on the disposable host. Supply a new installation root of at most 100
characters, unused API/PostgreSQL ports, an exact HTTPS origin resolving to one
local IPv4 address, and a canonical RFC1918 client subnet (for example
`192.168.1.0/24`). PostgreSQL listens only on `127.0.0.1`; the API binds the
origin's local address. Host and client must independently trust the certificate.
Windows Firewall must already run with all profiles enabled; a LAN interface
must already use the Private network category. The installer does not weaken
firewall policy or silently change the network category.

The publisher must assemble and sign the following bundle with the existing
[release-signing workflow](signed-releases.md). Dependencies must be ordinary
production files, not workspace symlinks. Keep signing keys outside the bundle.

```text
bundle/
  release.json                 outer signed manifest, including all files below
  app/
    release.json               separately signed flat application release
    apps/api/dist/...
    apps/web/dist/...
    packages/database/dist/...
    packages/database/migrations/...
    ...production packages/dependencies...
  installer/
    Common.ps1
    DeploymentChecks.ps1
    OfflineInstaller.ps1
    Start-OfflinePostgres.ps1
    Set-BackupSchedule.ps1
    Invoke-BackupJob.ps1
    BackupInstallation.ps1
  artifact-review.json
  vendor/...                   reviewed Node/PostgreSQL ZIPs and WinSW executable
  notices/...                  archived redistribution/dependency notices
```

Both signed application/bundle versions and target migration digests must agree
with the trusted operator release. Each signed review contains `format: 1`, a
`reviewReference`, UTC `reviewedAt`, `node`, `postgres`, and `winsw`. Node/PostgreSQL
entries contain `archive` (bundle-relative ZIP), `directory` (ZIP top folder),
`version`, official download `origin`, nonempty `notices` paths and `executables`
mapping executable-relative paths to independently approved lowercase SHA-256.
Node requires `node.exe`; PostgreSQL requires `bin/postgres.exe`, `bin/initdb.exe`,
`bin/pg_ctl.exe`, `bin/psql.exe`, `bin/pg_isready.exe`, `bin/pg_dump.exe` and
`bin/pg_restore.exe`. Additional executable hashes may also be listed.

The WinSW entry contains `file`, `version: "2.12.0"`, `variant: "NET461"`,
`origin: "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe"`
and `notices`. This targets the host's serviced .NET Framework rather than a
bundled obsolete runtime. The executable itself must be in the signed inventory.
No cached binary or self-calculated hash is independent publisher approval.
See [artifact review](windows-artifact-review.md); actual redistribution review,
approved artifact hashes and Authenticode signing are still outstanding.

## Private operator configuration

Provision private input directories first, readable only by the installing
administrator, SYSTEM and administrators. Ancestors must prevent replacement;
reparse points and shared writable paths are refused. All input files must be
outside the new installation root. Independently provide release/entitlement
Ed25519 public-key maps, TLS key/chain and pinned CA, and the existing
[owner provisioning input](identity-operations.md). No passwords go in arguments.

Create an enabled ordinary local backup account with no administrator membership.
On the same disposable host and under the installing administrator, use
`Get-Credential | Export-Clixml` to a private file for this account. Windows DPAPI
binds that export to the user/machine; do not copy it between machines. It is
imported in memory and handed to Task Scheduler, never serialized into task XML
or the installation record. The account's SID must match the configuration.

The configuration JSON has exactly these fields (replace all placeholders):

```json
{
  "format": 1,
  "installationId": "25a3a48f-7f24-4b65-ae13-b55cd3d5fa31",
  "root": "C:\\GST",
  "bundleRoot": "C:\\Publisher\\Bundle",
  "releaseTrustFile": "C:\\GST-input\\release-public-keys.json",
  "origin": "https://gst-host:3443",
  "databasePort": 55432,
  "privateSubnet": "192.168.1.0/24",
  "tlsKeyFile": "C:\\GST-input\\key.pem",
  "tlsCertFile": "C:\\GST-input\\chain.pem",
  "certificateTrustFile": "C:\\GST-input\\ca.crt",
  "certificateTrustSha256": "<independently approved 64-character lowercase SHA-256>",
  "entitlementTrustFile": "C:\\GST-input\\license-public-keys.json",
  "ownerInputFile": "C:\\GST-input\\owner.json",
  "backupCredentialFile": "C:\\GST-input\\backup-credential.xml",
  "backupAccountSid": "S-1-5-21-<machine components>-<account RID>",
  "backupDailyAt": "03:00"
}
```

From the trusted operator checkout/release, in an elevated console on that host:

```powershell
pnpm offline:host install --configuration C:\GST-input\install.json --confirm-installation 25a3a48f-7f24-4b65-ae13-b55cd3d5fa31
```

Verification precedes execution. Exact checked script bytes travel over stdin;
credentials and the development environment are not inherited. ZIP extraction
rejects traversal, alternate streams, device names, case collisions and excessive
size. Fresh PostgreSQL runs as `NT SERVICE\GSTBillingPostgres`; the API uses
`NT SERVICE\GSTBillingApi`. Installation never adopts an existing service,
database, role, task, firewall rule or root. WinSW 2.x XML uses `domain`/`user`.

The installer initializes a fresh cluster, verifies its actual data directory,
creates migration/backup and restricted API database identities, applies migrations
and the reviewed runtime grants, and provisions the owner/recovery material.
It registers daily/boot encrypted backups under the ordinary backup identity.
An explicit inbound block stays active until real HTTPS readiness, leaf pin,
frontend/liveness and process/listener identity pass. Only then does it admit the
configured private subnet and enable automatic service startup. No commercial
license or professional invoice issuance approval is fabricated.

## Retained layout and interrupted operations

`releases/<version>` contains application code; `vendor` contains reviewed tools.
`data`, `runtime`, `backups`, `backup-work`, `backup-key`, service logs and
`operator` remain outside versioned application files. `operator` retains private
database configuration/receipt, owner recovery material, native installation plan,
task XML, install lock and durable events. Protect and back up recovery material
separately; never publish these files or commit them.

`operations/installation.json` is the shared installed-version/schema pointer.
Future candidate applications for this layout belong in `releases/<version>`.
Supply `backupAccountSid` in Windows update/certificate service configuration,
alongside the existing backup task name. The adapter verifies its principal,
grants selected-release read access and regrants read access after atomic state
replacement; the scheduled job follows that pointer instead of the original CLI.

Failure retains evidence and data, attempts to isolate only proven-owned
registrations, and never recursively cleans or reinitializes a cluster. An
interrupted task registration without its ownership receipt needs inspection.
An existing/partial root blocks initial installation. Retained-data repair or
reinstallation is not yet an automated operation; do not delete the root or rerun
initial setup to force it. Its native acceptance remains outstanding.

## Data-preserving uninstall

From a separately protected trusted operator release, after arranging maintenance:

```powershell
pnpm offline:host uninstall --root C:\GST --confirm-installation 25a3a48f-7f24-4b65-ae13-b55cd3d5fa31 --maintenance
```

Uninstall acquires the same cross-process lock as updates/certificate operations.
Existing or interrupted maintenance blocks it. Exact protected installation,
service account/wrapper, backup task principal/definition and firewall filter
bindings are checked before mutation. A running backup must finish before the
database is stopped. Failed service stop prevents registration removal.
An explicit inbound block isolates the service while registrations are removed.

Only verified service, backup task and product firewall registrations are removed.
All application files, database, roles, settings, keys, backups, owner recovery
material and operation receipts remain. The backup Windows account and host/client
certificate trust remain under operator control. An interrupted uninstall retains
its distinct journal/lock for manual inspection; update recovery does not treat
that journal as an application rollback. No stale-lock timeout or automatic resume
is provided. Resolve the verified native state before any further operation.

## Safe local checks

The installer preflight unit suite mocks release/TLS/machine boundaries; existing
release and TLS suites exercise real signatures and TLS separately. PowerShell
decision suites mock all native system effects. Archive tests extract harmless
files only to a generated temporary fixture. The opt-in database test creates a
fresh labelled Docker container and removes only that fixture/anonymous volume:

```powershell
pnpm test
$env:TEST_OFFLINE_INSTALL_DOCKER = '1'
pnpm exec vitest run --project integration packages/database/src/install-database.integration.test.ts
Remove-Item Env:TEST_OFFLINE_INSTALL_DOCKER
./apps/windows-installer/scripts/Test-OfflineInstaller.ps1
./apps/windows-installer/scripts/Test-OfflineArchive.ps1
./apps/windows-installer/scripts/Test-BackupInstallation.ps1
./apps/windows-installer/scripts/Test-UpdateService.ps1
./apps/windows-installer/scripts/Test-DeploymentChecks.ps1
./apps/windows-installer/scripts/Test-BackupSchedule.ps1
./apps/windows-installer/scripts/Test-SpikeScripts.ps1
```

These checks do not prove the actual clean install, unattended VSA startup,
Windows ACL behavior, reboot/LAN access, real Task Scheduler credentials,
power-loss recovery, removal/reinstallation or distribution/signing acceptance.
