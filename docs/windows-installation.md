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
Future candidate applications for this layout belong directly inside `releases`:
either `<version>` or the protected `gst-release-<six characters>` directory
returned by release staging. The installed-state pointer selects the actual root.
Supply `backupAccountSid` in Windows update/certificate service configuration,
alongside the existing backup task name. The adapter verifies its principal,
grants selected-release read access and regrants read access after atomic state
replacement; the scheduled job follows that pointer instead of the original CLI.
For installer-created service layouts, the native adapter also binds the journal
parent to this root's `operations` directory and the original runtime/node/task
identities. A copied state file in another journal directory cannot bypass shared
update/certificate/repair/uninstall exclusion. Legacy manually provisioned service
layouts retain their existing explicit configuration boundary.

Failure retains evidence and data, attempts to isolate only proven-owned
registrations, and never recursively cleans or reinitializes a cluster. An
interrupted task registration without its ownership receipt needs inspection.
An existing/partial root blocks initial installation. Use the explicit repair
workflow below for a previously completed installation; never delete the root or
rerun initial setup to force it. An interrupted initial installation without a
completed installation receipt remains an inspection boundary, not an adopted
database. Native acceptance remains outstanding.

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
is provided. Use the explicit inspection/recovery workflow below for operations
created by the current host command.

## Repair or reinstall over retained data

`repair` restores a previously completed installation, including one whose
registrations were removed by uninstall. It requires the **exact installed
application version and migration digest**, the matching trusted operator release,
and the same independently approved Node/PostgreSQL/WinSW payloads. This is not an
upgrade or an opportunity to replace database, identity, origin or licensing.
The file inventory must also match the original protected installation receipt
or authenticated original/target inventory saved by the assisted updater. A
republished package with different files but the same version is refused; repair
cannot bypass normal maintenance eligibility. Older update records without the
required inventory evidence are an inspection boundary, not inferred authority.

Supply a new private repair configuration containing exactly:

```json
{
  "bundleRoot": "C:\\Publisher\\Bundle",
  "releaseTrustFile": "C:\\GST-input\\release-public-keys.json",
  "certificateTrustFile": "C:\\GST-input\\current-ca.crt",
  "certificateTrustSha256": "<approved lowercase SHA-256 of the current CA file>",
  "backupCredentialFile": "C:\\GST-input\\backup-credential.xml"
}
```

The signed source bundle must be outside the retained installation. The CA is
independent current trust for the retained TLS pair, including a pair replaced by
the controlled certificate workflow. The DPAPI credential must still match the
original ordinary backup account. Initial owner/password input is not needed.
Keep these files unchanged and available until the operation is resolved.

```powershell
pnpm offline:host repair --root C:\GST --configuration C:\GST-input\repair.json --confirm-installation 25a3a48f-7f24-4b65-ae13-b55cd3d5fa31 --maintenance
```

The command acquires shared maintenance exclusion, verifies every present
registration, isolates ingress, disables the backup job and stops owned services.
It restores signed application files and the original approved tools. Changed
files are atomically replaced with originals and target/hash receipts retained in
the protected operation directory; unchanged files are not overwritten. Unlisted
application/vendor files are refused, never silently deleted. Trusted operator
bootstrap/backup helpers and service definitions are restored separately from the
signed application. Missing proven service/task registrations are recreated;
same-name registrations belonging to another account/root are never adopted.

PostgreSQL restarts with `ExistingClusterOnly`: missing initialized-cluster
evidence cannot cause `initdb`. A separately trusted verifier uses read-only
sessions to check the actual data directory, cluster system identifier, exact
migration history, database owner and restricted runtime permissions. It never
migrates, creates/drops a database/role, changes passwords or provisions an owner.
Application signatures/inventory, process/listener identity, frontend, readiness
and the current certificate pin are verified before normal operation is restored.

Database contents, installation UUID, settings, TLS pair, entitlement trust,
credentials, backup key/archives, owner recovery material and installed-state
pointer remain. Required service/backup read/write permissions are restored to
the same identities. Failed repair retains evidence and isolation for recovery.
Damaged/missing protected identity, configuration, key or cluster evidence is
refused; it is not replaced with defaults or reconstructed by guessing.

## Explicit interrupted-uninstall or repair recovery

Stop the previous operator process and its helper processes before recovery.
Find the operation ID in the protected lock owner file (do not edit it):

```powershell
(Get-Content C:\GST\operations\gst-update.lock\owner.json -Raw | ConvertFrom-Json).operationId
pnpm offline:host inspect --root C:\GST --operation-id <operation-uuid> --confirm-installation 25a3a48f-7f24-4b65-ae13-b55cd3d5fa31
```

Inspection reads the saved intent, lock, original journal/permit, retained inputs
and actual owned registration state. It returns `fingerprint` and `actorAlive`;
it does not start/stop services or change files. A busy native execution guard
blocks inspection. Once the previous operator is stopped, use its fresh result:

```powershell
pnpm offline:host recover --root C:\GST --operation-id <operation-uuid> --confirm-installation 25a3a48f-7f24-4b65-ae13-b55cd3d5fa31 --maintenance --operator-stopped --expected-inspection-sha256 <fingerprint>
```

The command finishes the saved operation: uninstall removes only verified owned
registrations; repair resumes the exact saved repair inputs and version. There
is no implicit rollback or switch from one operation kind to another. Live
operator PIDs (with creation-time checks), stale inspection, changed bindings,
foreign locks and competing claims fail before mutation. Native actions hold an
exclusive file handle and replace an execution permit under that handle, so a
delayed old helper cannot resume after recovery takes over.

Torn final original-journal bytes are retained verbatim. Recovery writes separate
attempt/completion receipts and archives only the verified resolved lock. If it
is interrupted again, stop that operator, inspect again and supply the new
fingerprint; the old fingerprint is invalid after permit replacement. Never
remove unknown lock contents or use a stale-lock timeout. Old prototype journals
without a durable offline intent/permit, incomplete initial setup, corrupt
identity evidence or unavailable/changed repair inputs need operator inspection;
the command refuses to infer authority from names alone. No commercial license
or invoice compliance gate is bypassed.

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
./apps/windows-installer/scripts/Test-OfflineRepair.ps1
./apps/windows-installer/scripts/Test-OfflineRepairFlow.ps1
./apps/windows-installer/scripts/Test-UpdateService.ps1
./apps/windows-installer/scripts/Test-DeploymentChecks.ps1
./apps/windows-installer/scripts/Test-BackupSchedule.ps1
./apps/windows-installer/scripts/Test-SpikeScripts.ps1
```

These checks do not prove the actual clean install, unattended VSA startup,
Windows ACL behavior, reboot/LAN access, real Task Scheduler credentials,
power-loss recovery, removal/reinstallation or distribution/signing acceptance.
