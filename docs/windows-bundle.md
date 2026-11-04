# Preparing the Windows installation bundle

This publisher workflow assembles the existing application and operator installer.
A prepared candidate is unsigned and is not an approved customer installer.
It installs nothing on the development laptop.

Use the pinned project toolchain and `pnpm install --frozen-lockfile` first.
Preparation copies the installed production dependency graph into ordinary files,
preserves conflicting versions, retains licenses, and excludes development
dependencies and non-Windows native prebuilds. It does not download dependencies
or run their installation scripts. Links, private-looking files and missing
dependencies fail. The inventory records package versions and the lockfile hash.

Run on Windows. Choose a new output under a private parent such as LocalAppData.
The existing ACL check refuses replaceable ancestors; do not disable it or alter
drive permissions to bypass a failure. Partial output is retained, never reused.

## Prepare and test

Supply exact vendor archives, WinSW, notices and `artifact-review.json` from the
[artifact review](windows-artifact-review.md). Download observations and hashes
are review evidence, not automatic approval. The exported `derivePostgresRuntime`
function in `scripts/issuer/windows-vendor.ts` produces a server/tools-only ZIP
from a SHA-256-pinned EDB archive, retaining bin/lib/share and license notices.
It excludes pgAdmin/StackBuilder and never executes a vendor binary. Retain the
source archive and derivation observations for independent review.

Create a UTF-8 JSON configuration without a BOM:

```json
{
  "format": 1,
  "repositoryRoot": "E:\\GST-Billing-Invoice-Management-System",
  "outputDirectory": "C:\\Users\\Publisher\\AppData\\Local\\GST-candidate-new",
  "metadata": {
    "format": 1,
    "version": "0.1.0",
    "minimumInstalledVersion": "0.0.0",
    "fromSchemaDigest": "<baseline migration SHA-256>",
    "toSchemaDigest": "<this build migration SHA-256>",
    "nodeMajor": 24,
    "postgresMajor": 18
  },
  "vendor": {
    "directory": "C:\\PublisherInputs",
    "reviewFile": "C:\\PublisherInputs\\artifact-review.json"
  }
}
```

`pnpm db:schema` prints this build's migration digest. An initial engineering
candidate can use the same baseline digest; an update needs its real supported
baseline. The example version does not establish a published product release.

```powershell
pnpm bundle:prepare --configuration C:\PublisherInputs\candidate.json
pnpm bundle:smoke --root C:\Users\Publisher\AppData\Local\GST-candidate-new
```

Preparation builds the project and creates bundle/app, bundle/installer,
bundle/vendor and bundle/notices. Outside that directory, release-metadata.json
and build-report.json record metadata and unresolved release requirements.
No developer environment, keys, credentials, databases or workspace links ship.

Smoke starts the locally assembled API with the publisher's trusted Node, a
temporary loopback port and an isolated environment. All ESM/CommonJS resolution
outside bundle/app is blocked. It checks API, frontend/assets, native addon
loading and Origin rejection. Without database input, readiness must report
unavailable; that is not database acceptance. Optional BUNDLE_TEST_DATABASE_URL
enables read-only readiness against an explicitly selected test database. No
migration or provisioning runs, and downloaded vendor executables never run.

## Approval and signatures

An authorized reviewer must independently supply an approval JSON receipt. Add
vendor.approvalFile to the configuration and prepare into another new output.
The receipt has format: 1, reviewSha256 (exact review bytes), approvedBy,
approvedAt (UTC ISO timestamp), licensesReviewed: true, files (every declared
archive/executable/notice path mapped to approved SHA-256) and evidence (nonempty
URLs). The tooling never creates real approval on the reviewer's behalf.

Sealing refuses missing approval, changed pins or mismatched runtime/migration
metadata. Supply existing encrypted Ed25519 credentials and approved public trust.
Keep keys outside the bundle and set ISSUER_KEY_PASSPHRASE securely in the
environment, never command arguments.

```powershell
pnpm bundle:seal --root C:\Private\Candidate\bundle --metadata C:\Private\Candidate\release-metadata.json --key-id publisher --key-file C:\PrivateKeys\release.pem --trust C:\PublisherInputs\release-public.json
pnpm bundle:verify --root C:\Private\Candidate\bundle --trust C:\PublisherInputs\release-public.json
```

The inner application is signed first, followed by the outer installer/vendor
inventory. Verification checks both signatures, inventories, vendor approvals,
archive executable hashes/architecture, migration digests and runtime versions.
Failed or partially sealed output stays quarantined; prepare a new candidate.

Ed25519 package signing does not replace Windows Authenticode distribution
signing. Production keys, independent redistribution approval, code-signing and
the postponed disposable Windows host/client install/reboot/LAN/recovery tests
remain release gates. This is an operator-run directory bundle, not a fabricated
signed setup executable. See [installation](windows-installation.md).
