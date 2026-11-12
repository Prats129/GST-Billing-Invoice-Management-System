# Windows Setup & Recovery

Batch 5 supplies a small native Windows application for the offline host. It uses
the existing installation, licensing, backup, certificate, update and recovery
engines. It runs independently of the Billing browser, API service and database.
There is no remote connection from Platform Admin to an offline installation.

The locally compiled application is an **unsigned engineering candidate**.
Production Authenticode signing and the postponed disposable Windows host/client
acceptance are still required. An unsigned, untrusted or changed maintenance
package refuses host actions. Do not test installation on the development laptop.

## Coverage against the approved plan

This is a coverage review, not an expansion of Batch 5. "Connected locally"
means the native interface calls the existing engine and has local test evidence;
it does not establish native Windows production acceptance.

| Agreed item                              | Current coverage                                                                                                                                                                                       | Remaining work                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| C1: installation configuration/preflight | Connected locally: reviewable suggestions for a new standard root, observed unused ports, and a single private interface with its actual subnet mask. Existing strict preflight remains authoritative. | Real host acceptance; multiple interfaces require an explicit operator choice.                                                              |
| C2: backup identity                      | Connected locally: Windows standard-account creation guidance, secure account selection, SID checks and effective batch-logon validation before DPAPI credential capture.                              | Real account/policy acceptance. Account creation and policy preparation remain in Windows administration; the tool never grants privileges. |
| C3: initial installation                 | Connected locally: separate native launcher/runtime, review/confirmation and existing durable installer evidence.                                                                                      | Production signature and actual clean/partial-install acceptance.                                                                           |
| C4: LAN connection/client trust          | Connected locally: dedicated connection guide combines the saved origin, configured server certificate SHA-256/subject/issuer/validity and client CA instructions.                                     | Actual second-client DNS, TLS trust and connectivity acceptance.                                                                            |
| C5: signed license import                | Connected locally: file selection, verified claims preview and existing host installation transaction.                                                                                                 | Actual signed host acceptance.                                                                                                              |
| C6: assisted update                      | Connected locally: package/eligibility review, explicit immediate maintenance confirmation, verified backup, forward-copy update and recovery references.                                              | Actual Windows acceptance. Future unattended scheduling is not implemented; coordinate the maintenance window before executing.             |
| C7: retained-data repair                 | Connected locally to exact-version repair and existing ownership/data safeguards.                                                                                                                      | Actual retained-data repair acceptance.                                                                                                     |
| C8: preserving uninstall                 | Connected locally with explicit retained-data review and existing owned-registration checks.                                                                                                           | Actual preserving-uninstall acceptance.                                                                                                     |
| C9: interrupted recovery                 | Connected locally for saved repair/uninstall, certificate and update records.                                                                                                                          | Actual process-crash/power-loss acceptance. Incomplete initial installs lacking sufficient evidence remain operator-review cases as agreed. |

The three previously partial guidance items are now connected locally. This does
not establish commercial release acceptance: production signing and the postponed
native host/client tests remain required. No unattended update scheduler or remote
offline control is added.

## Using the current native interface

Open `maintenance/GSTBillingMaintenance.exe`, choose **Enable administrator
mode**, approve Windows UAC, select the installation folder and choose a task:

| Task                              | Result                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Check installation                | Current service/task ownership and trusted local HTTPS/database readiness observations.                                                                |
| Install a new host                | A form collects host/network and publisher-supplied inputs; a verified plan is reviewed before creating a new installation.                            |
| Install signed license            | Select a signed JSON grant, review its claims and apply it using the existing host-only verifier.                                                      |
| Run verified backup               | Start the existing owned scheduled backup under its ordinary backup account, then wait for a new successful restore-verification receipt.              |
| Update from signed bundle         | Verify the target package, review all-organization maintenance eligibility, make/verify a backup and update a separate application/database copy.      |
| Replace HTTPS certificate         | Select replacement key/chain and independently approved CA fingerprint, review and replace the pair during maintenance.                                |
| Repair existing installation      | Restore the exact installed version using its matching signed bundle and retained identity.                                                            |
| Inspect interrupted operation     | Read the current lock and saved repair, uninstall, certificate or update evidence.                                                                     |
| Recover inspected operation       | Review fresh evidence and explicitly finish saved maintenance or return to the selected certificate/original update recovery point.                    |
| Uninstall and keep data           | Remove verified product registrations while retaining databases, files, accounts, keys, backups and recovery evidence.                                 |
| Prepare backup account credential | Capture credentials for an existing enabled ordinary local account in a Windows dialog; save a new Windows-protected credential file and show its SID. |
| Trust a verified LAN certificate  | After independent fingerprint confirmation, install the exact verified public CA on this Windows computer.                                             |
| Prepare initial owner account     | Capture business/owner details and a masked initial password into a new private file for the installation engine.                                      |
| Connection guide                  | Show the saved HTTPS address with configured public server certificate identity and instructions for independently verified client CA trust.           |

Tasks have a review/confirmation step and visible progress/result area. Forms
retain non-secret entries during the session so a failed validation can be fixed
without re-entering everything. Passwords are excluded from retained form drafts.
Closing is blocked while an operation is running. Windows shutdown or process
failure can still interrupt work; reopen the tool and inspect before retrying.

This changes the separate Windows maintenance interface. It does not add another
administration menu to the customer Billing website or Platform Admin.

## Initial installation

1. Obtain the publisher-approved signed bundle and separately packaged maintenance
   tool. Keep the maintenance tool outside the intended installation root so it
   remains available for repair. Preserve its exact folder contents.
2. Prepare the host inputs with the deployment operator: a new local installation
   folder, unused database/HTTPS ports, stable HTTPS name, intended private subnet,
   valid TLS key/chain, public CA with independently verified SHA-256, and approved
   release/license public-key files. The tool does not invent certificate trust,
   signing authority, network configuration or publisher approval.
3. Create an ordinary local backup account using Windows account settings. Give
   it a strong password and the required local batch-logon policy. It must be
   enabled and must not be an administrator. Use **Prepare backup account
   credential**, selecting a new file in the private operator-input folder.
   Effective batch-logon policy and account authentication must pass before the
   credential is saved. Each attempt is a real Windows authentication attempt and
   is subject to account lockout policy; the tool does not retry passwords. If
   Windows denies batch logon, ask the host administrator
   to prepare policy; the tool does not grant rights or override a deny policy.
   The resulting path and SID are prefilled in the installation form for review.
   The protected credential
   is bound to the same Windows host and installing administrator.
4. Use **Prepare initial owner account** and retain the resulting private path.
   This creates the input only; the actual owner is provisioned during the
   existing transactional installation workflow.
5. Choose **Install a new host**, review the detected suggestions and fill the
   remaining publisher inputs. Multiple private interfaces (including VPNs) leave
   the address/subnet blank rather than guessing. Suggested ports are observations,
   not reservations; preflight rechecks them. Suggested IP addresses need a DHCP
   reservation or replacement with a stable certificate-covered DNS name. No
   certificate or key is automatically trusted. The tool generates one
   installation UUID for the reviewed attempt. It uses the existing strict
   signature, TLS, network, path, account and collision preflight.
6. Review the exact root, identity, version and access effect. Confirm only when
   these are correct. Success follows real engine admission/readiness checks.
7. Secure the separately created owner recovery material, encryption keys and
   installation records. Remove the temporary owner-password input after
   successful setup. Retain required repair/credential/trust inputs privately.

If a root already exists, initial installation refuses it. Completed retained
installations use **Repair**. An incomplete initial install without enough
identity/ownership evidence remains an operator-inspection case; the tool does
not erase it, initialize it again or adopt an unrelated database.

The detailed engine input meanings and retained layout remain in
[Windows installation](windows-installation.md). Supported host OS, serviced
.NET Framework, network/firewall and independent certificate-trust prerequisites
remain unchanged.

## Maintenance and recovery

Updates require active maintenance **at execution time for every organization**.
Perpetual billing rights are independent of maintenance expiry. The facade uses
the matching target-schema operator release; arbitrary migrations are not read
from an input directory. Use the target maintenance package for an update and
the exact matching installed package for retained-data repair.

The preview binds the request, installation fingerprints, selected material and
fresh inspected state. Execution recomputes the preview before making changes.
The underlying engines still repeat signature, entitlement, ownership and
transaction checks at their normal protected execution points.

Normal maintenance refuses an existing shared operation lock. A manual backup
uses the same scheduled task observed/disabled by the update engine, so it cannot
become an invisible administrator backup racing service maintenance. A timeout
does not stop a backup or claim that it failed to commit; inspect its task/status.

Interrupted repair/uninstall continues only the recorded kind and exact inputs,
using the existing permit/fingerprint fence. Certificate recovery selects
**previous** or **replacement** and checks the actually observed active pair.
Update recovery uses persisted application references and database OIDs; returning
to the original data point may lose later writes, which must be explicitly
accepted. Stop the previous operator/helpers before confirming recovery.
Corrupt, conflicting, incomplete or older unsupported evidence fails closed.
Recovery does not clear locks by age, delete retained copies or bypass licensing,
RBAC or tax/compliance restrictions.

Successful license installation can be repeated safely after a lost reply: the
existing entitlement engine recognizes the identical signed grant. It does not
issue a replacement grant or invent a new signing sequence.

## Publisher packaging and signing

For test-only self-signed Authenticode use the separate
[internal signing workflow](internal-windows-signing.md). It preserves the same
native signature/publisher checks and does not replace production release gates.

First assemble, approve and seal the existing [Windows bundle](windows-bundle.md).
The bundle must include the newly compiled lifecycle entrypoint and helper files.
Build a separate maintenance package on the Windows publisher machine:

```powershell
& ./scripts/Use-ProjectToolchain.ps1
pnpm bundle:launcher --bundle C:\Publisher\SealedBundle --trust C:\Publisher\release-public-keys.json --output C:\Publisher\NewMaintenance --certificate C:\Publisher\publisher-code-signing.cer
```

`--certificate` is a **public** DER/PEM code-signing certificate. No signing key
or password enters this command. Without it an inert unsigned candidate can be
compiled, with a zero signer pin; host actions remain blocked. To distribute,
rebuild with the real public certificate, Authenticode-sign the resulting
`maintenance/GSTBillingMaintenance.exe` externally using the matching protected
key, and verify the package before delivery. Do not create production keys,
import a development trust root or disable verification to get past this gate.

The builder verifies the sealed outer/application manifests and reviewed vendor
inputs, copies the signed application inventory, extracts only the pinned
`node.exe` and compiles the native shell. Its embedded resource binds every
maintenance runtime file, approved release public keys and expected publisher
certificate SHA-256. Public build reports sit outside the runtime folder.
The runtime folder must contain exactly the assembled files plus its signed
executable; extra modules/configuration, reparse points, changed hashes or
untrusted write access block execution.

The native shell checks Windows Authenticode trust and the pinned publisher,
then checks runtime paths, ACLs, file inventory and hashes before invoking code.
It repeats verification after review. Privileged inputs travel through bounded
stdin; Node options and developer environment variables are excluded. Native
helpers are a fixed allowlist. No named-pipe server, general command field,
SQL console, background privilege service or signing material is introduced.

Windows signature validation uses the local trust cache without network
retrieval. Deployment must provision the approved certificate chain beforehand.
This offline policy cannot promise fresh online revocation information.
[Microsoft documents the cache-only option](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_data).
Certificate renewal requires a new publisher-approved maintenance build if its
pinned signing certificate changes.

## Verification and release boundary

Safe local checks:

```powershell
pnpm test
powershell -NoProfile -File apps/windows-installer/launcher/Test-WindowsLauncher.ps1
powershell -NoProfile -File apps/windows-installer/scripts/Test-LifecycleHost.ps1
powershell -NoProfile -File apps/windows-installer/scripts/Test-LanTrust.ps1
powershell -NoProfile -File apps/windows-installer/scripts/Test-SpikeScripts.ps1
```

The native test compiles, checks argument/path handling and unsigned-signature
rejection, and renders an off-screen form. Generated fixtures stay under ignored
`.local/launcher-test-*`; no administrator action is invoked. Packaging regression
uses an inert Node archive and ephemeral release keys.

Before commercial release, run the existing [Windows acceptance matrix](windows-deployment-checks.md)
on a disposable host plus separate client with the actual signed package:
clean/duplicate/partial installation, standard-user denial, UAC cancellation,
tampered runtime and CA fingerprints, account/task permissions, offline operation,
reboot/LAN access, interrupted/failed updates, certificate recovery, exact-version
repair and preserving uninstall. Include disk-full, missing-key/identity and
foreign PostgreSQL/service collisions. Native service/trust/credential execution
is not established by mocked or off-screen checks.
