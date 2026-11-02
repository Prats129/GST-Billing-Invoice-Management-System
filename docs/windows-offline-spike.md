# Phase 1 Windows offline feasibility spike

Phase 6 adds a [read-only host/client checker](windows-deployment-checks.md) for
the running prototype. Its locally tested observation logic does not replace
the unverified native service/TLS/LAN/reboot and installer matrix below.

Status on 2026-10-27: **UNVERIFIED deployment prototype**. The development host is Windows, but has no PostgreSQL tools on PATH; no service, firewall, trust-store or installer changes were attempted. The purpose is to make the risky deployment steps executable and reviewable before building a commercial installer.

## Verification evidence

| Check                                                                                          | Result                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse all seven PowerShell scripts using Windows PowerShell parser                             | PASS: `powershell -NoProfile -File apps/windows-installer/scripts/Test-SpikeScripts.ps1`                                                                                                 |
| SHA-256 executable verification helper: correct checksum accepted, incorrect checksum rejected | PASS on current Windows host; no executable launched                                                                                                                                     |
| Create protected directory ACL through `New-PrivateDirectory`                                  | BLOCKED: sandbox returned `Set-Acl: Attempted to perform an unauthorized operation`. Empty test directory removed. The helper stops before writing any credentials when ACL setup fails. |
| PostgreSQL initialization/start/stop, migrations against native Windows instance               | UNVERIFIED: supplied PostgreSQL binaries required                                                                                                                                        |
| WinSW preparation/install/start/stop/reboot, identity and graceful shutdown                    | UNVERIFIED: approved binary and disposable elevated VM required                                                                                                                          |
| CA/leaf creation, actual client trust, Chrome/Edge LAN access                                  | UNVERIFIED: approved OpenSSL executable, Windows clients and explicit administrator trust required                                                                                       |
| Firewall restriction and blocked access from other networks                                    | UNVERIFIED: administrator/network VM test required                                                                                                                                       |
| Upgrade, restore, signed installer, production uninstall                                       | Deferred release engineering work; these scripts do not implement them                                                                                                                   |

Script parser checks do not prove deployment works. Do not run privileged steps on a customer's host before the VM matrix below passes.

Separate foundation verification subsequently initialized/started temporary native
PostgreSQL 18.4 binaries on this Windows host, ran migrations/integration tests,
confirmed a loopback-only listener, and stopped the cluster. This validates the
application/database boundary, not the dedicated lifecycle scripts, installer or
Windows service. Loopback HTTP frontend checks passed in headless Chrome and Edge;
LAN HTTPS certificate trust remains UNVERIFIED. See review-coverage.md.

## Prerequisites and artifact provenance

Use disposable Windows 11 x64 host and separate Windows browser client on a private test subnet. Windows Server compatibility remains unverified. Reserve a stable DNS hostname (example `gst-host`) and DHCP address; use DNS consistently rather than a changing IP. Check hostname resolution from every client. Never ask users to bypass browser warnings.

Build the repository using the root README. Stage the built application, production dependencies and Node runtime in a directory that ordinary users cannot modify. Keep secrets and data outside the application release directory. Use absolute local paths, not mapped drives or network shares. Select a currently security-patched supported Node LTS and PostgreSQL 18 minor release; retain exact versions, hashes, licenses and origin URLs in the operator's test evidence.

Supply an approved WinSW x64 release and OpenSSL 3 executable yourself. Scripts require independently obtained SHA-256 digests and do not download or trust a hash fetched alongside an untrusted binary. WinSW configuration uses its [bundled executable/XML workflow](https://github.com/winsw/winsw/blob/v3/docs/xml-config-file.md); test the exact approved version before packaging. No signing keys or third-party binaries are committed.

The proposed commercial route is a dedicated PostgreSQL instance managed by the Windows installer. The official [Windows download page](https://www.postgresql.org/download/windows/) identifies the EDB installer; its [documented options](https://www.enterprisedb.com/docs/supported-open-source/postgresql/installing/command_line_parameters/) include distinct prefix, data directory, service name, port, service account and option file. Do not use an unattended command with a password on its command line. Review a protected option-file approach, installer trace redaction and deletion of temporary credentials on a VM first. Never reuse or reconfigure a customer's existing `postgres` account/service/cluster. PostgreSQL's [license](https://www.postgresql.org/about/licence/) permits redistribution subject to its terms; the installer distribution and bundled dependencies require their own license review before shipping. No redistribution approval is claimed here.

## Dedicated PostgreSQL lifecycle prototype

As a **standard Windows user**, obtain verified PostgreSQL binaries with `bin/initdb.exe`, `bin/pg_ctl.exe` and `bin/psql.exe`. This prototype exercises an isolated user-run cluster and deliberately does not register a database service under LocalSystem. The proposed installer-managed service and dedicated service identity remain an open validation item.

From the repository root, substitute actual local paths:

```powershell
$pgBin = 'C:\GST-PoC\postgresql\bin'
$pgData = 'C:\GST-PoC\data'
& .\apps\windows-installer\scripts\Invoke-PostgresPoC.ps1 -Action Initialize -BinDirectory $pgBin -DataDirectory $pgData -Port 55432
& .\apps\windows-installer\scripts\Invoke-PostgresPoC.ps1 -Action Start -BinDirectory $pgBin -DataDirectory $pgData
& .\apps\windows-installer\scripts\Invoke-PostgresPoC.ps1 -Action Status -BinDirectory $pgBin -DataDirectory $pgData
& "$pgBin\psql.exe" -h 127.0.0.1 -p 55432 -U gst_poc_admin -d postgres -W
```

Initialization prompts for a superuser password through `initdb -W`, uses SCRAM authentication, restricts the directory ACL and sets `listen_addresses='127.0.0.1'`. The HBA allows only IPv4 loopback and password authentication. A marker binds later operations to this exact PoC cluster/binary directory. An existing data directory is never initialized or overwritten. A failed initialization is left for operator inspection; the script never recursively deletes data. These behaviors follow PostgreSQL's [initdb documentation](https://www.postgresql.org/docs/current/app-initdb.html).

In the interactive SQL session create distinct non-superuser migration and runtime roles and set passwords using `\password`, not SQL literals in saved scripts:

```sql
CREATE ROLE gst_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password gst_migrator
CREATE DATABASE gst_billing OWNER gst_migrator;
CREATE ROLE gst_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password gst_runtime
GRANT CONNECT ON DATABASE gst_billing TO gst_runtime;
```

Use the migration role only for the root README's explicit migration command; use the runtime role for the API. After applying the first migration, connect to `gst_billing` as the migration role or bootstrap administrator and grant only the privileges required by Phase 1 readiness:

```sql
\connect gst_billing
GRANT USAGE ON SCHEMA public TO gst_runtime;
GRANT SELECT ON TABLE public.organizations TO gst_runtime;
```

Those minimal grants describe the original Phase 1 checkpoint only. The current
Phase 2 checkout also reads/writes identity, session and authorization tables;
apply the restricted runtime privilege guidance in [identity operations](identity-operations.md)
after its migration. Keep provisioning/recovery on the operator connection, and
do not grant runtime DDL, table ownership or audit UPDATE/DELETE/TRUNCATE privileges.

The readiness query checks the migrated table and column shape without returning business records. These grants do not allow application writes, schema changes, ownership or superuser access; future modules must add reviewed privileges as needed. Keep the bootstrap superuser out of the API environment. URI-encode generated passwords in database connection URLs and keep the environment file ACL restricted. This PoC does not implement role provisioning for the eventual installer.

Confirm from SQL: `SHOW listen_addresses; SHOW port; SHOW password_encryption;`. From the host, `Get-NetTCPConnection -LocalPort 55432 -State Listen` must show only `127.0.0.1`. From a second PC, `Test-NetConnection gst-host -Port 55432` must fail. Do not add a PostgreSQL firewall allow rule.

Stop explicitly after the test:

```powershell
& .\apps\windows-installer\scripts\Invoke-PostgresPoC.ps1 -Action Stop -BinDirectory $pgBin -DataDirectory $pgData
```

Use `pg_dump -Fc` and a separate restore target for recovery testing; copying a live data directory is not a backup. Backup scheduling/encryption, restore validation and automated DB service startup are later release gates.

## HTTPS and explicit private CA trust

Use an operator-only CA directory separate from the API-readable leaf directory. The CA key is encrypted with an interactively entered passphrase. The leaf key is unencrypted so the service can start unattended, protected by Windows ACLs. Leaf certificates are short lived (90 days); CA lifetime is two years. The API now has [certificate validity/expiry reporting](https-operations.md). Automated certificate renewal, CA/client-trust replacement and host replacement remain unfinished.

```powershell
& .\apps\windows-installer\scripts\New-LanCertificate.ps1 -OpenSslPath 'C:\GST-PoC\tools\openssl.exe' -OpenSslSha256 '<independently-verified-64-hex-digest>' -DnsName 'gst-host' -CaDirectory 'C:\GST-PoC\operator-ca' -ServerDirectory 'C:\GST-PoC\tls'
```

The script creates new directories only, generates a private CA and DNS-SAN server certificate, verifies the chain and hostname, and exports only `ca.cer` for client distribution. Keep CA private key and passphrase away from the running service and clients. For each host/client, compare the `ca.cer` SHA-256 through an independent channel with the operator. In an elevated PowerShell console run:

```powershell
& .\apps\windows-installer\scripts\Trust-LanCa.ps1 -CertificatePath 'C:\GST-PoC\tls\ca.cer' -ExpectedSha256 '<verified-64-hex-digest>' -WhatIf
& .\apps\windows-installer\scripts\Trust-LanCa.ps1 -CertificatePath 'C:\GST-PoC\tls\ca.cer' -ExpectedSha256 '<verified-64-hex-digest>'
```

The second command explicitly asks before importing the public CA into the machine root store. Trusting this CA allows it to authenticate other TLS sites on that client; restrict custody of its private key accordingly. A private CA trust workflow still needs usability/security review before production. Never distribute the CA key, bypass certificate warnings, use `curl -k`, or disable certificate validation. Record the imported CA's thumbprint for explicit future trust removal; uninstall does not silently remove trust used by other clients.

## API Windows service prototype

Create a protected production environment file outside source control. In addition to the root `.env.example` fields, use these deployment settings with real absolute paths:

```dotenv
NODE_ENV=production
DEPLOYMENT_EDITION=offline
HOST=0.0.0.0
PORT=3443
APP_ORIGIN=https://gst-host:3443
ALLOWED_HOSTS=gst-host:3443
TLS_KEY_PATH=C:/GST-PoC/tls/server.key.pem
TLS_CERT_PATH=C:/GST-PoC/tls/server.cert.pem
WEB_ROOT=C:/GST-PoC/application/apps/web/dist
```

Set the API database URL to the runtime role on loopback port 55432. The migration connection must use the migration role. Do not include the CA key path in the environment. `ALLOWED_HOSTS` contains exact HTTP authorities including port; `APP_ORIGIN` is the exact browser origin. Phase 1 exposes its public operations schema at `/api/openapi.json`; it has no interactive documentation UI or enable/disable switch, preserving the strict content security policy. No authentication or customer billing is offered by this Phase 1 service.

```powershell
& .\apps\windows-installer\scripts\Set-ApiService.ps1 -Action Prepare -ServiceRoot 'C:\GST-PoC\api-service' -WinSwPath 'C:\GST-PoC\tools\WinSW-x64.exe' -WinSwSha256 '<independently-verified-64-hex-digest>' -NodePath 'C:\Program Files\nodejs\node.exe' -AppRoot 'C:\GST-PoC\application' -EnvironmentFile 'C:\GST-PoC\offline.env'
```

Preparation creates XML and a renamed verified wrapper, copies the environment into the restricted service directory, and configures **LocalService**, never LocalSystem. LocalService is a shared low-privilege identity used only for this feasibility test; production should use a dedicated virtual/service identity after testing its directory and logon permissions. Grant LocalService read/execute access to the staged application/runtime and read access to the **leaf** TLS files/parent directories only. Grant modify access only to the service's logs (the script handles that directory), never application code or CA secrets. Verify effective ACLs in the VM. No account password is stored in XML. Secrets stay in the protected environment file; XML contains paths only.

In an elevated console, review each operation and execute:

```powershell
& .\apps\windows-installer\scripts\Set-ApiService.ps1 -Action Install -ServiceRoot 'C:\GST-PoC\api-service'
& .\apps\windows-installer\scripts\Set-ApiService.ps1 -Action Start -ServiceRoot 'C:\GST-PoC\api-service'
Get-CimInstance Win32_Service -Filter "Name='GSTBillingApiPoC'" | Select-Object Name, State, StartName, PathName
```

The prototype starts manually so a failed spike cannot persistently restart at boot. Service automatic/delayed start, PostgreSQL dependency ordering, recovery policy, Windows shutdown semantics, upgrade sequencing and crash-loop behavior remain unverified release gates. WinSW stop behavior must be checked against the Nest graceful-shutdown hooks on the exact runtime/wrapper combination.

## Private LAN firewall and browser check

Use the actual subnet; do not change a public network to Private merely to make the test pass. `-WhatIf` displays the intended firewall operation; omit it only after reviewing. The script permits explicit RFC1918 IPv4 CIDR ranges, the Private profile, one Node executable and one HTTPS port only; it blocks edge traversal and never adds a database rule.

```powershell
& .\apps\windows-installer\scripts\Set-LanFirewall.ps1 -Action Add -PrivateSubnet '192.168.10.0/24' -NodePath 'C:\Program Files\nodejs\node.exe' -Port 3443 -WhatIf
& .\apps\windows-installer\scripts\Set-LanFirewall.ps1 -Action Add -PrivateSubnet '192.168.10.0/24' -NodePath 'C:\Program Files\nodejs\node.exe' -Port 3443
```

On host and second PC, open `https://gst-host:3443/` in current Chrome and Edge. Expect a trusted chain, correct SAN, UI connectivity and readiness after database migration. Confirm no certificate warning. Unplug internet while keeping LAN active; repeat. Verify a client outside the allowed subnet cannot connect and a Public-profile network has no allowed inbound rule. Confirm spoofed Host/Origin are rejected by API integration tests and direct requests. Phase 1 has no user sessions; secure cookies/CSRF/session rotation remain Phase 2 work.

## Safe teardown and outstanding VM matrix

Stop API, then uninstall only the PoC wrapper service:

```powershell
& .\apps\windows-installer\scripts\Set-ApiService.ps1 -Action Stop -ServiceRoot 'C:\GST-PoC\api-service'
& .\apps\windows-installer\scripts\Set-ApiService.ps1 -Action Uninstall -ServiceRoot 'C:\GST-PoC\api-service'
& .\apps\windows-installer\scripts\Set-LanFirewall.ps1 -Action Remove -PrivateSubnet '192.168.10.0/24' -NodePath 'C:\Program Files\nodejs\node.exe' -Port 3443
& .\apps\windows-installer\scripts\Invoke-PostgresPoC.ps1 -Action Stop -BinDirectory $pgBin -DataDirectory $pgData
```

All application files, environment, logs, certificates, PostgreSQL data and backups remain on disk. No recursive deletion is implemented. Explicitly inspect and archive those paths before any manual cleanup. Do not use a vendor uninstaller to remove a customer's existing PostgreSQL instance.

Before calling this deployment feasible, record results on clean Windows 11 x64 and each proposed Server version: first install with no PostgreSQL, coexistence with existing PostgreSQL, non-admin runtime, offline reboot and startup ordering, private/public firewall behavior, trusted Chrome/Edge LAN access, CA mismatch/expired certificate rejection, renewal and hostname replacement, DB crash/start failure, log secret review, backup/restore, safe uninstall preserving data, and reinstall against preserved data. Signed installer/update packages and production backup/restore are later phases.
