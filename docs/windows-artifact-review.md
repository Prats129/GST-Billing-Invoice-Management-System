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
[connected execution plan](phase-6-execution.md) for the remaining workstreams.
