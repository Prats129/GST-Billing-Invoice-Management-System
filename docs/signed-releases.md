# Signed release preflight

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

Protected staging is implemented below. Installation/service control, maintenance,
live forward migration, live recovery/cutover and reboot acceptance remain unfinished.
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
