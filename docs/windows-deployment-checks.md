# Read-only Windows deployment checks

Use this after the existing [Windows feasibility setup](windows-offline-spike.md)
on the disposable host and its **separate** Windows LAN client. It observes the
running PoC; it does not install, start, stop, reboot, repair or remove anything.
It does not change firewall rules, ACLs, services, certificate stores or secrets.
No production installer or completed Windows deployment acceptance is implied.

**Postponed by the user:** the available development laptop has 8 GB RAM and
Windows 11 Home Single Language; no disposable host/separate client is available.
Do not install a Windows guest or alter this laptop's service/trust configuration
to work around the missing test environment. Resume this matrix on suitable test
machines later. Postponement does not waive the commercial release gate.

## What it checks

Both modes require an exact HTTPS origin whose DNS addresses are exclusively
RFC1918 IPv4 addresses, consistent with the current firewall prototype. Public,
loopback, unresolved, IPv6/mixed-address targets and URLs containing credentials,
paths, queries or fragments are rejected. Use the configured stable LAN hostname;
the trusted certificate must cover it. No TLS warning bypass, certificate callback,
proxy or HTTP redirect is accepted. Responses are bounded to 64 KiB with request
and read timeouts.

The checks verify the API's versioned liveness and database-readiness responses
and that the frontend HTML references a built JavaScript asset. They do not
execute the frontend or exercise authenticated billing operations.

Host mode additionally checks:

- The origin resolves to this host's local IPv4 interfaces.
- Node and WinSW files match independently approved SHA-256 hashes.
- The service XML selects the expected application, Node, LocalService account
  and protected service environment path.
- The registered PoC service runs as LocalService through the expected wrapper.
- The API listener belongs to a matching Node child of that wrapper.
- The configured PostgreSQL port is listening only on `127.0.0.1`/`::1`.

Client mode requires the origin's addresses to be absent from the client's local
interfaces. It checks that the configured PostgreSQL port is unreachable at every
resolved host address. A failed TCP connection alone does not prove a particular
firewall rule caused it; combine it with the host's positive listener observation.
Checks apply to the **supplied ports**, not a scan for every possible database.

## Run on the host

Use an account permitted to inspect service/process executable information and
TCP listeners. Restricted inspection fails the relevant check. Supply the exact
approved hashes already reviewed during PoC setup; do not obtain trusted hashes
from the same untrusted download you are trying to validate.

```powershell
.\apps\windows-installer\scripts\Test-WindowsDeployment.ps1 -Mode Host -Origin 'https://gst-host:3443' -DatabasePort 55432 -ServiceRoot 'C:\GST-PoC\api-service' -NodePath 'C:\Program Files\nodejs\node.exe' -AppRoot 'C:\GST-PoC\application' -NodeSha256 '<approved-64-hex-digest>' -WinSwSha256 '<approved-64-hex-digest>'
```

This targets the existing `GSTBillingApiPoC`/LocalService prototype. A future
production service with a dedicated identity needs its separately reviewed
configuration/checks; do not weaken the account check to accept LocalSystem.

## Run on the separate client

Copy the checker and adjacent `DeploymentChecks.ps1` to the test client. Configure
the approved private CA trust through the existing explicit operator workflow
first. The checker never imports the CA or changes execution policy.

```powershell
.\Test-WindowsDeployment.ps1 -Mode Client -Origin 'https://gst-host:3443' -DatabasePort 55432
```

Exit 0 means the requested observations passed. Exit 1 reports a failed observation
or invalid input. Standard output is JSON containing UTC observation time, mode,
origin and named booleans. It omits credentials, environment contents, HTTP bodies
and raw exception messages. Save the report in the protected deployment record;
the checker does not create an evidence file or overwrite one.

## Required manual matrix

Record actual host/client OS versions, approved artifacts/hashes and results for
each scenario. Do not equate a passing report with all of these being complete.

1. On the clean disposable host, verify protected code/configuration/TLS ACLs and
   the intended service identity. Keep the CA key and migration/backup credentials
   outside the API account's access. The checker does not certify effective ACLs.
2. Run both checks and use Chrome and Edge on the separate client. Verify trusted
   HTTPS, sign-in, authorized business access and expected license/tax gates.
3. Disconnect internet while retaining the private LAN; repeat both checks and
   browser operations. Record this as a distinct observation.
4. Perform the approved offline reboot/startup-order test, without manually
   starting services before observing the result. Record boot identity/time and
   startup behavior, then repeat checks. The current manual-start PoC does not
   implement commercial automatic startup or a managed PostgreSQL service.
5. Verify rejection from outside the allowed subnet and under the Public network
   profile. A passing private-LAN check alone does not verify firewall scope.
6. Verify untrusted, expired and wrong-host certificates are rejected; inspect
   logs for secrets and test database/service failure and graceful shutdown.
7. Test the reviewed backup/recovery switch, safe uninstall/reinstall preserving
   data, and coexistence with an existing PostgreSQL installation. Signed
   installer/update acceptance remains separate release work.

## Local verification status

`Test-DeploymentChecks.ps1` runs real PowerShell decision/JSON-contract and secure
XML parsing tests with mocked DNS, HTTPS, service/process, hash and network
observations. It exercises healthy host/client results and failure cases without
contacting a LAN host or modifying machine configuration. The Windows CI job also
runs it; remote CI has not been executed from this session.

Run the available safe checks from the project root:

```powershell
.\apps\windows-installer\scripts\Test-SpikeScripts.ps1
.\apps\windows-installer\scripts\Test-DeploymentChecks.ps1
.\apps\windows-installer\scripts\Test-BackupSchedule.ps1
```

Actual native service/TLS/client trust/LAN/reboot and installer checks remain
**unverified** until the disposable VM, approved binaries and separate client
are available. No service or CA was installed on the development laptop.

References: [Microsoft HTTP request/timeout/redirect behavior](https://learn.microsoft.com/en-us/dotnet/api/system.net.httpwebrequest?view=netframework-4.8.1),
[Windows TCP listener ownership](https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-nettcpconnection?view=windowsserver2025-ps).
