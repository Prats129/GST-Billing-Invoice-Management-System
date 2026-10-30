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
