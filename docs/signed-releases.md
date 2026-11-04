# Signed release preflight

Current publisher custody decision (2026-11-04): the project owner/developer will
own the release key and keep it in dedicated encrypted offline storage. The
owner confirmed the encrypted storage is not prepared yet. Its mounted location,
encryption/recovery arrangements and production key are not yet provisioned.
This does not authorize writing a private key into the checkout.
The current user certificate store contains no code-signing private certificate,
and SignTool was not found on PATH during the local check. No production signature
has been made. The existing signing commands are ready to consume real credentials.

## Production signing handoff

First resolve the concrete [vendor approval findings](windows-artifact-review.md).
Do not mark licensesReviewed true merely to unblock the command. Review the
supplemented WinSW notices and retained PostgreSQL dependencies, then prepare a
new candidate using the approved receipt. Preserve earlier unsigned outputs.

For the Ed25519 release key, prepare and unlock the owner's encrypted offline
storage, choose a new private directory, and arrange an independently recoverable
encrypted backup. Keep the storage outside the checkout, candidate and cloud sync.
Before creation, verify the mounted path and directory ACLs; stop if existing key
files are present. Use a trusted OpenSSL supporting Ed25519. The following are
operator templates, not commands executed in this session:

```powershell
# Replace the path only after validating the actual encrypted storage.
# OpenSSL prompts locally for a strong passphrase; do not put it in arguments.
openssl genpkey -algorithm ED25519 -aes-256-cbc -out X:\GST-signing-new\release-private.pem
openssl pkey -in X:\GST-signing-new\release-private.pem -pubout -out X:\GST-signing-new\release-public.pem
```

OpenSSL can overwrite output files: the operator must first create a new private
directory and verify both targets are absent. Never paste the private PEM or its
passphrase into chat. Map the exported public PEM to the chosen release key ID in
a separate public trust JSON. Independently verify its fingerprint and distribute
that trust through the controlled installer/operator channel; a bundle cannot
approve its own replacement trust. Keep release and license-issuance keys separate.
Test decryption/public-key matching and a disposable signed fixture before using
the key on an approved candidate. Back up and test recovery before relying on it.

Windows publisher identity requires a real CA-issued code-signing certificate or
approved signing service. Select that provider using the owner's verified identity;
we have not purchased, enrolled, imported a certificate or installed root trust.
Use the provider's non-exportable/token/service key handling where required.
An arbitrary self-signed certificate is not a customer-trusted substitute.

Use a separate private publisher checkout to Authenticode-sign the allowlisted
first-party scripts in apps/windows-installer/scripts **before bundle:prepare**.
The helper allowlists are in scripts/issuer/windows-bundle.ts. Assembly copies
those signed bytes into bundle/installer and app/apps/windows-installer/scripts,
then records their inventory for smoke testing. Each distributed copy must verify.
Do not sign the development checkout or re-sign a prepared candidate in place.
Do not re-sign or change vendor binaries/archives. With an
explicitly selected current-user certificate and the CA's timestamp endpoint,
the documented SDK command shape is:

```powershell
signtool sign /s My /sha1 <approved-certificate-thumbprint> /fd SHA256 /tr <CA-RFC3161-timestamp-URL> /td SHA256 <explicit-first-party-script-path>
signtool verify /pa /all /v <explicit-first-party-script-path>
```

The /sha1 option selects a certificate; the content and timestamp digests use
SHA-256. Follow the selected provider for hardware/service-backed signing.
Verify the expected publisher, chain, timestamp and signature success; a warning
or missing timestamp is not successful release acceptance. See Microsoft's
[SignTool reference](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool).
Then seal and verify the inner/outer Ed25519 inventories with the existing bundle
commands. Any content change after sealing requires a new candidate and signature.
Run bundle:smoke on that newly prepared candidate before bundle:seal. The earlier
unsigned candidate's inventory correctly rejects files changed in place.
Never edit a build report to make changed code executable. The approved signed
bundle still needs the postponed native Windows acceptance tests.

Phase 6 provides an operator-only verifier, not a production Windows installer.
It authenticates a release manifest and every staged file without executing any
package contents or modifying an installation, database, service or trust store.

## Verification format

The staged root contains `release.json` with exactly `{keyId,payload,signature}`.
Payload is unpadded canonical base64url JSON; signature is unpadded base64url
Ed25519 over UTF-8 `GST-RELEASE-V1\n<keyId>\n<payload>`. The domain differs from
license grants, so a signed entitlement cannot authorize an executable update.
Use separately controlled release-signing keys; no private signing key is shipped.

The signed manifest contains format version 1, semantic `version` and
`minimumInstalledVersion` (three numeric components), exact `fromSchemaDigest` and
`toSchemaDigest`, Node major 24, PostgreSQL major 18 and a bounded file list with
relative `path`, `bytes` and SHA-256. Package generation/signing remains a trusted
publisher duty; prerelease versions and rollback installation are not supported.

Verification rejects unknown keys, signature tampering, rollback/incompatible
versions/schema, modified/missing/unlisted files, duplicate case-insensitive paths,
path traversal, absolute/alternate-stream paths, Windows reserved filenames,
symlinks/junctions and files that resemble private keys/backups/environment data.
Stage dependencies as ordinary files, not development checkout symlinks. Maximum
manifest size is 2 MiB, 10,000 files and 20,000 directory entries.

```powershell
pnpm release:verify --root 'C:\GST-staging\release' --trust 'C:\GST-private\release-public-keys.json' --installed-version 1.0.0 --schema-digest '<installed migration digest>'
```

The trust file maps approved key IDs to Ed25519 SPKI public PEM keys. Provision
and ACL-protect it independently of an untrusted downloaded package. The installed
version/schema arguments must come from protected installation state, not from
the candidate update. The output describes a verified candidate; it does not
approve tax policy, prove the declared target schema, install an update or establish
Windows Authenticode trust. Never execute files from an unverified package.

## Remaining commercial installer/update gate

### Offline maintenance eligibility

User-confirmed policy: maintenance must be active **when installing**, for every
organization sharing the offline installation. Release publication date does not
preserve update eligibility after maintenance expires. Perpetual billing remains
available when maintenance expires; this rule only restricts application updates.

`pnpm release:eligibility` performs a host-only, read-only preflight using
`MIGRATION_DATABASE_URL`, `ENTITLEMENT_TRUST_FILE` and `OFFLINE_INSTALLATION_ID`
from the protected operator environment (or the existing project `.env`). It
requires offline configuration and valid signed, active, host-bound grants with
future `maintenanceUntil` for **all** organizations, including archived/suspended
ones. No tenant ID argument or development bypass is accepted. Missing maintenance
also blocks trial/subscription grants; subscription validity alone is not proof
of maintenance. The operator connection must see the entire installation database.
RLS-filtered queries fail rather than silently excluding organizations.

Success reports only organization count and check time; failures omit tenant
identities, grant contents, paths and credentials. Grants/clock markers are not
modified. This checks the local system clock against stored observations, not an
independent trusted time service; it does not defeat whole-machine rollback.

Verification/staging commands still check package integrity independently of
licensing. This new preflight neither installs files nor authorizes a later
installation: the future assisted updater must call the shared eligibility policy
again immediately before installation under its maintenance/write-stop protocol,
prevent organization/grant changes during that operation and refuse if time has
crossed the expiry boundary. It must separately verify package integrity, backup,
schema compatibility and service recovery. No production updater is claimed here.

Protected staging is implemented below. Installation/service control, maintenance,
live forward migration, live recovery/cutover and reboot acceptance remain unfinished.
The [assisted-update sequencing core and protected journal](assisted-updates.md)
are implemented and locally testable. A schema-preserving host adapter now binds
real backup/database operations and implemented Windows service/file control.
Native acceptance, initial installation and a production installer entrypoint
remain unfinished; no operator update command is advertised yet.
Explicit forward migration of an isolated recovery copy is now available through
backup prepare-recovery; see backup-recovery.md. It does not install an update.

A commercial assisted updater must still implement and validate on a disposable
Windows VM: Windows publisher signing and trust, approved binary redistribution,
protected staging immune to modification between verification and use, least-
privilege service/database identities, maintenance/write stop, a freshly verified
backup, explicit forward migrations, actual post-migration schema validation,
service restart/readiness and controlled recovery to the prior database/release.
An unsuccessful update must not attempt an unreviewed schema downgrade or erase
customer data. Uninstall must retain databases/backups/configuration unless the
operator explicitly chooses otherwise.

No Windows code-signing certificate or SaaS provider is currently available. No
installer was signed, installed, reboot-tested or published in this session.
The verifier's cryptographic/file/path/junction tests use ephemeral test keys.

## Publisher command

`pnpm release:sign` inventories and hashes an existing protected staging tree,
validates release metadata, signs with an externally supplied encrypted Ed25519
PKCS8 key, and checks the result through the customer verifier. Its publisher
scripts are excluded from the Docker build context and customer API/web imports.
The command does not generate a private key, publish files or execute the package.

Prepare a metadata JSON outside the staged tree containing the manifest fields
above **except `files`**, which are generated from the real file tree. Use the
reviewed source/target migration digests and a target version greater than the
minimum installed version. Unknown fields, unsupported runtimes, secrets,
symlinks/junctions and case-colliding paths/directories are rejected. Provision
production dependencies as ordinary files, not pnpm development symlinks.

Inject `ISSUER_KEY_PASSPHRASE` using the protected publisher process environment,
as described in licensing-operations.md. Use a separate release key and public
trust map; no customer key or license grant authorizes release signing.

```powershell
pnpm release:sign --root 'C:\Publisher-staging\release' --metadata 'C:\Publisher\approved-release.json' --key-file 'C:\Publisher-private\release.pem' --key-id release-2026 --trust 'C:\Publisher\release-public-keys.json'
```

Keep the signing key, passphrase, metadata and trust files outside staging. Its
new `release.json` is created exclusively; an existing manifest is never replaced.
No other files are written. The staging directory must be controlled by the
publisher and immutable during signing/verification. If final verification fails,
quarantine that directory, including any incomplete manifest, and rebuild in a
new staging directory. The command does not delete files as an attempted repair.
The verifier rejects unknown files/sizes before reading their contents.

End-to-end publisher CLI tests use ephemeral encrypted keys, then the actual
customer verifier. This is application-level signing, independent of Windows
Authenticode. No commercial installer executable was signed, installed, updated
or reboot-tested, and a declared target digest still requires actual migration
and post-update readiness validation by the assisted installer.

## Protected update staging

```powershell
pnpm release:stage --root 'C:\GST-downloads\release' --staging-parent 'C:\GST-private-staging' --trust 'C:\GST-private\release-public-keys.json' --installed-version 1.0.0 --schema-digest '<installed migration digest>'
```

Provision the staging parent first, under an operator account separate from the
API identity. It must be outside the downloaded tree and protected against other
users renaming/deleting its children. The command verifies the signed download,
creates a new `gst-release-<random>` directory, applies private permissions before
copying, then copies only the
signed file list with bounded size/hash checks. It re-verifies the staged copy
and requires the exact original manifest before reporting success. No package
code is executed; no files, configuration or services are installed or replaced.

On Windows the new directory has a protected NTFS ACL for the current operator,
SYSTEM and Administrators. Owner/reparse/unsafe ancestor ACL checks reject paths
where other users could replace the directory despite its private ACL. On POSIX,
the directory is mode 0700, files 0600; untrusted ownership/writable ancestors are
rejected, with root-owned sticky temporary directories permitted. Paths with
junctions/symlinks and a destination inside the download are rejected. Private
staging does not protect against an administrator or the operator account itself.

Each invocation generates a new directory; existing staged releases and unrelated
files are never overwritten. Failure attempts cleanup of only that invocation's
generated child. Inspect the protected parent after storage/OS failures. Keep it
private throughout the future update workflow and re-check integrity immediately
before use; explicitly provision service read access only during controlled
installation. This command does not prove the declared target migration digest,
grant Windows Authenticode trust, start maintenance or perform live cutover.
