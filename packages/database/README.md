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
Phase 1 readiness needs SELECT on public.organizations only.

Integration tests require an explicitly supplied `TEST_DATABASE_ADMIN_URL` with
CREATEDB privilege on a disposable cluster. They create and drop only a randomized
`gst_test_<uuid>` database, apply the complete history twice, assert DB constraints
and rollback behavior, and close connections. Never point this at production.
Interrupted tests may leave databases with this prefix: inspect before manual
cleanup. No shared development database is truncated.
