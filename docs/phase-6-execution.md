# Phase 6 remaining execution plan

Execute this as one connected release workflow, preserving checkpoints in
review-coverage.md. Do not turn individual helpers into claims of a finished
installer, restart planning after each helper or add unrelated product features.

1. Complete failed-update inspection and explicit recovery using the existing
   journal, database OIDs, retained application/service definition and database
   rollback. Verify ambiguous commit, wrong installation, changed records and
   failure-to-stop cases. Never infer rollback from a failed command or clear an
   interrupted operation lock without verified recovery.
   Local implementation and regression coverage are complete for schema-preserving
   updates; native Windows acceptance remains pending.
2. Complete initial installation and data-preserving uninstall around a protected
   installation record, dedicated service/database identities and independently
   approved runtime/PostgreSQL/wrapper artifacts. Connect update/recovery to that
   record. Keep configuration, database and backups outside versioned application
   files. Validate repeat invocation/collisions and interrupted operations.
   Shared installed-state initialization/replacement is implemented. Native
   provisioning still needs the reviewed artifacts in windows-artifact-review.md
   and the postponed host/client environment; no unsigned cached binary is adopted.
3. Extend the same update/recovery workflow to supported forward schema changes
   on a separate copy. Original release/database must be recoverable together;
   never require an unsafe down migration. Keep unsupported transitions blocked.
   Forward-copy orchestration and paired schema evidence/recovery are implemented.
   Real PostgreSQL migration/rollback and orchestration fault checks are recorded
   in review-coverage.md. No licensed pre-Phase-6 upgrade or native Windows
   acceptance is claimed; each future schema needs reviewed retained readiness.
4. Finish commercial operating workflows with real issuer key custody, certificate
   renewal/trust procedures and the chosen SaaS provider/subscription process.
   Do not select a provider, publish prices, create production signing keys or
   assert professional tax approval on the user's behalf.
   Publisher-only local issuance registration and exact committed-grant export
   are implemented. Production authority/storage/key custody, existing-history
   reconciliation, provider and certificate operations remain external work.
5. Run integrated local regression checks, then collect the postponed disposable
   Windows host/client install/update/failure/recovery/uninstall/LAN/reboot evidence
   and actual SaaS backup/restore evidence before commercial release.

Work continuously within locally verifiable scope. Native Windows acceptance is
explicitly postponed by the user; no privileged deployment is run on this laptop.
Signing/redistribution approval, suitable test machines, a SaaS provider and
professional tax review remain external gates, not completed engineering work.
When a missing input genuinely blocks a workstream, document that boundary and
continue independent authorized work. No extra product phase is introduced.
