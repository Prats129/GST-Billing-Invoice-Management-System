# Windows installer artifact boundary

Reviewed 2026-11-03 to identify the concrete next dependency for initial
installation. This is an artifact review note, not redistribution/signing approval
or a replacement for the postponed Windows acceptance tests.

- Keep the project's Node 24 and PostgreSQL 18 baseline. Do not upgrade runtime
  majors as part of installer work.
- PostgreSQL's [official Windows download page](https://www.postgresql.org/download/windows/)
  links EDB's installer and binary ZIP; it explicitly describes the ZIP as intended
  for inclusion in another application installer. Evaluate a PostgreSQL 18 ZIP
  against the existing dedicated-cluster design rather than adding pgAdmin or
  StackBuilder to this product. Archive exact vendor source, version, checksums,
  notices and dependencies before approving an artifact for the bundle.
- The [official WinSW releases](https://github.com/winsw/winsw/releases) distinguish
  stable 2.x from 3.x prereleases. [v2.12.0](https://github.com/winsw/winsw/releases/tag/v2.12.0)
  is a candidate for feasibility review, not an approved product dependency.
  Select and verify the exact x64/runtime variant and its dedicated service
  account/startup/stop behavior before implementing vendor-specific provisioning.
  Do not silently substitute an alpha release or an arbitrary third-party build.

Implementation targets the stable `WinSW.NET461.exe` variant on a serviced
.NET Framework 4.8+ Windows host, avoiding the old self-contained runtime in the
other release variant. The publisher must still independently approve and pin
the actual executable; no approved binary is added by this change. Stable 2.x
[XML configuration](https://raw.githubusercontent.com/winsw/winsw/v2.12.0/doc/xmlConfigFile.md)
uses `serviceaccount/domain` + `user`, correcting the prototype's `username` field.
The [MIT notice](https://raw.githubusercontent.com/winsw/winsw/v2.12.0/LICENSE.txt),
[PostgreSQL license](https://www.postgresql.org/about/licence/) and every bundled
dependency notice must be archived in the signed artifact review. The official
PostgreSQL Windows page lists tested server platforms; it does not establish
Windows 11 acceptance for this product.

The repository currently has no approved WinSW executable. Cached PostgreSQL
executables were found, but their presence is not independent vendor/checksum or
redistribution approval. No executable was downloaded, installed, approved or
run during this review. No signing certificate or disposable host/client is
available. Initial native provisioning/uninstall acceptance cannot be completed
from these cached files or from mocked service tests.

The shared installed-state record and explicit update recovery are implemented
independently. The initial installer must create that record only after validating
the actual host, service identities, protected configuration and database. It must
not adopt an existing database/service merely because its name matches. See the
[connected execution plan](phase-6-execution.md) and
[initial lifecycle](windows-installation.md) for the implemented boundaries and
remaining workstreams.

## Candidate observations, 2026-11-04

Bundle work now downloads official Node 24.22.1, EDB PostgreSQL 18.6-5 and WinSW
2.12.0 inputs into ignored local storage. The earlier no-download statement
describes the initial review, not this continuation. Node's ZIP matches its
published checksum. PostgreSQL's server/tools subset is derived with retained
source/derived hashes and notices. Static ZIP/PE inspection passed without running
vendor executables. WinSW's release asset API exposes no independently published
digest. No self-calculated hash becomes approval, and no real approval receipt or
signing key is created. See [bundle preparation](windows-bundle.md).

## Approval review result, 2026-11-04

**Decision: pending; do not issue a vendor-approval.json receipt yet.**
This review records concrete evidence and unresolved distribution requirements.
It is not an allegation about upstream compliance or a professional legal opinion.

| Input                                 | Observed SHA-256                                                 | Current evidence                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Node 24.22.1 Windows x64 ZIP          | d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5 | Matches the official SHASUMS256.txt; full upstream Node/dependency LICENSE retained.                                       |
| EDB PostgreSQL 18.6-5 Windows x64 ZIP | e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2 | Matches EDB's published contributor checksum in issue 733; dependency source/build and notice coverage remain open.        |
| Derived PostgreSQL server/tools ZIP   | 613699b53df6ce24af5292eaa8ef0448c0b7835f944e798348f6cc247c8d9d15 | Retained source pin and derivation observations; derivative approval must include its actual libraries.                    |
| WinSW.NET461.exe 2.12.0               | b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f | Official release download; local Authenticode inspection reports NotSigned. No independently published asset digest found. |

The [EDB checksum response](https://github.com/EnterpriseDB/edb-installers/issues/733)
provides provenance evidence that was missing from the earlier download snapshot;
the original observations are preserved rather than rewritten as prior approval.

The exact archive includes libintl-9.dll, libiconv-2.dll, libwinpthread-1.dll,
ICU, curl and wxWidgets DLLs. Its command-line third-party notice groups gettext,
iconv and pthreads under LGPL. EDB's
[October 30 clarification and follow-up](https://github.com/EnterpriseDB/edb-installers/issues/743)
identifies gettext 0.19.8 and libiconv 1.19 as unmodified upstream sources, and
clarifies that the winpthreads DLL is permissively licensed, not LGPL. Do not
infer its precise source revision or original notices from that generic notice.
The follow-up still requests release-specific build records and the exact
winpthreads revision. The
[release-tag package list](https://raw.githubusercontent.com/EnterpriseDB/edb-installers/REL_18_6-5-Win/server/packages-win64.txt)
and [copy/build script](https://raw.githubusercontent.com/EnterpriseDB/edb-installers/REL_18_6-5-Win/server/scripts/windows/compile.ps1)
identify inputs but do not by themselves supply all corresponding materials.
The [public source catalog](https://www.enterprisedb.com/modified-gpl) currently
lists gettext 0.19.8 and libiconv 1.15; the latter does not establish the source
for the shipped 1.19 DLL. Complete source-delivery and original-notice coverage
for the actual retained binaries before approving redistribution. Do not remove
DLLs to bypass review without verifying the executable dependency closure.

WinSW's tagged
[merge target](https://raw.githubusercontent.com/winsw/winsw/v2.12.0/src/WinSW/WinSW.csproj)
and [Core dependencies](https://raw.githubusercontent.com/winsw/winsw/v2.12.0/src/WinSW.Core/WinSW.Core.csproj)
include log4net 2.0.12 and YamlDotNet 8.1.2 in NET461. Their upstream LICENSE and
log4net NOTICE have now been downloaded into new local notice files. A separate
artifact-review-supplemented.json draft lists them; it remains unapproved.
These additions are not silently inserted into the original candidate or review.
Use that reviewed draft in a new build once the outstanding review is resolved.

Application packaging now retains the complete notices for the frontend dependency
graph separately from server node_modules, with a hashed frontend-notices.json
inventory. Missing frontend license text blocks assembly. This fixes a concrete
gap; minified browser banners are not treated as the full license text.

No external issue/comment/email was posted during this review. A responsible
publisher must obtain missing records and make the final redistribution decision.
