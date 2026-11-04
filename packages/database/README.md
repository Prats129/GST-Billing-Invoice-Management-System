# Database boundary

`src/schema.ts` is the declarative model; `migrations/` is the reviewed release
history. Generate with `pnpm db:generate`, review SQL and metadata, commit together.
Never edit an applied migration, use `push`, or migrate at application startup.
Run `pnpm db:migrate` explicitly with `MIGRATION_DATABASE_URL` in the root `.env`
or process environment. The CLI never falls back to application credentials.

Migration invocations serialize with a PostgreSQL session advisory lock; failures
release the lock and connection. Drizzle records applied migrations transactionally.
Back up before release migrations; forward fixes or tested restore are preferred
to assuming schema downgrade is safe. PostgreSQL schema ownership remains with
the migration role. Grant runtime only schema usage and required table operations.
Phase 2 readiness checks identity/session tables and owner-guard availability too.
Runtime needs the limited DML privileges described in docs/identity-operations.md;
never table ownership/DDL. Audit rows reject UPDATE/DELETE/TRUNCATE. Global identity
audit events have no organization; tenant events and reads always use organization_id.

0001_identity_authorization.sql adds identities, sessions, permissions and tenant-safe
links; reviewed SQL also installs deferred owner constraints and parent-row locking.
The corresponding snapshot represents declarative tables; custom trigger behavior
is maintained explicitly in SQL. Existing Phase 1 rows are not deleted or silently
assigned an owner. Explicit host provisioning can adopt an ownerless legacy org.

Integration tests require an explicitly supplied `TEST_DATABASE_ADMIN_URL` with
CREATEDB privilege on a disposable cluster. They create and drop only a randomized
`gst_test_<uuid>` database, apply the complete history twice, assert DB constraints
and rollback behavior, and close connections. Never point this at production.
Interrupted tests may leave databases with this prefix: inspect before manual
cleanup. No shared development database is truncated.

0002_business_catalog.sql adds business/registration/customer/catalog master data,
tenant-safe classification revisions/reviews and new permission definitions.
It preserves existing memberships/grants and installs append-only classification
guards and a deferred requirement for an initial catalog classification.
New Phase 3 runtime privileges and local setup steps are documented in docs/phase-3.md.

0006_user_appearance.sql adds constrained theme mode and accent preferences to
users, with system/teal defaults for existing accounts. Existing user SELECT/
UPDATE privileges cover these columns; no additional runtime grants are needed.

0003_serious_paibok.sql adds invoices, counters, financial lines/components and
immutable snapshots. Reviewed triggers protect finalized rows, reject financial
mutation/truncation and enforce deferred snapshot/line/component reconciliation.
Never reset/delete issued counters. New permission definitions do not expand
existing grants. Runtime needs SELECT/INSERT/UPDATE on invoices and invoice_series,
SELECT/INSERT on invoice_lines, invoice_tax_components and invoice_snapshots, plus
existing identity/master-data/audit privileges; no DDL, ownership, DELETE or
TRUNCATE. Commercial issuance remains blocked in the service release policy.

0004_mute_vapor.sql extends existing storage with PNG logos, correction drafts and
append-only invoice_cancellations. It replaces the single-reversal index with a
tenant/original index, adds debit series support and deferred cumulative correction
balance checks. Cancellation guards preserve original rows, prevent later mutation
and reject unsupported issued-note cancellation. Runtime additionally needs SELECT/
INSERT on invoice_cancellations; no UPDATE/DELETE/TRUNCATE. The migration inserts
invoices.cancel without granting it to existing non-owners. Never rewrite 0003.
