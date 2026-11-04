# Phase 5 — invoice workflow

## Ordinary invoice release (2026-11-05)

The project owner reports that their CA reviewed and approved the supported
calculations, rounding, invoice fields and numbering, and authorized release.
This records their confirmation; no independent report, reviewer identity or
government approval is asserted. The source policy now permits ordinary domestic
invoices within the existing supported boundary. No tax rates, calculations or
rounding semantics changed. Engine version 1.0.1 records the release metadata.

Business setup/registration confirmation, reviewed classifications, current
permissions, fresh preview digest, version checks, transaction locks, consecutive
numbering and immutable snapshots still apply. E-invoice applicability must be
assessed as `not_required`; unknown/required remain blocked. IRP integration is
explicitly postponed. Credit/debit note issuance and issued cancellation remain
outside this release; their drafts/engineering coverage remain available.

Save a supported draft, calculate/review a fresh preview and choose **Finalize
invoice**. Tests issue only synthetic documents in disposable databases. The
dated records below describe the original implementation and earlier gate state.

Status: the Phase 5 engineering scope is implemented: invoice drafts, transactional
finalization/snapshots, full and partial value credits, debit notes, cancellation,
logo customization and A4 printing. Commercial issuance remains disabled pending
professional compliance approval. Continuation verification is recorded below and
in review-coverage.md. Existing data, credentials and user-staged changes are preserved.

Build the permission-gated invoice workspace, persisted/versioned drafts, server-side
calculation from tenant master data, transactional numbering/finalization, immutable
financial/render snapshots, linked corrections and a versioned A4 print template.
No payments, inventory, PDF service, IRP integration or cloud synchronization.

Commercial issuance remains blocked by the Phase 4 policy (`issuanceAllowed=false`).
No environment switch, browser checkbox or organization setting can bypass that
release gate. Unknown/required e-invoice applicability also blocks issuance. Drafts
and their print previews must visibly say that they are not tax invoices.

Engineering choices:

- Number format `INV/2627/000001` (credit `CN`, debit `DN`), registration/FY/document
  scope; April financial-year boundary, row-locked counters, no database sequences.
- Issue date and supply date are separate. Reject future issue dates (Indian date).
- Organization lock serializes draft/finalization/master-data/permission mutations.
  Version checks protect drafts; a UUID request key makes create/finalize retries
  idempotent and rejects changed payloads.
- The browser sends catalog/customer IDs and guided facts, never trusted prices,
  tax reviews, calculation authority or totals. Prices/classifications/permissions
  are derived by the server; explicit overrides retain actor and reason.
- Finalization recomputes and requires the same preview digest the operator reviewed;
  master-data changes require another review. Normalized lines/components and a
  checksummed versioned snapshot commit with number, transition and audit.
- Corrections use `original-value-adjustments.v1`: enter positive pre-tax value
  adjustments against original lines. Debits retain original classification/rates
  and balanced intra-state rounding. Credits consume remaining original plus issued
  debit values minus issued credits, with proportional remaining combined tax and
  deterministic allocation of component paise. A final reversal consumes every
  remaining paisa. No new discounts, physical quantities, rates or tax-only changes
  are inferred. Original/customer/catalog snapshots stay immutable; snapshots retain
  original and prior-note digests so the balance basis can be reconstructed.
- Correction drafts are versioned and editable. Finalization recalculates balances
  under the organization lock. Deferred DB guards independently enforce original
  line/classification matching and nonnegative remaining value/component balances.
- Cancellation appends an immutable record; it never edits financial snapshots or
  reuses numbers. Draft discard is available. Issued cancellation requires its own
  permission, finalization authority, confirmed no supply/not reported status, no
  active linked corrections and the same non-bypassable release/e-invoice gates.
  Issued correction notes need an explicit counter-adjustment instead. Local
  cancellation cannot stand in for an IRP/return operation or legally effective credit.
- Logos are PNG data only (64 KiB, maximum 1024 × 1024); the browser decodes and
  normalizes uploads, shared/server validation bounds format/header/dimensions, and
  the renderer validates before embedding. No remote/SVG/script content is accepted.
  Historical documents retain their saved logo. Applied migration 0003 stays intact;
  additive 0004 extends storage and installs the new guards/permission definition.

Official sources reviewed 2026-10-29:
[Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001)
and [Rule 53](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000144/1000001)
specify document particulars and consecutive numbers of at most 16 characters.
[Section 34](https://taxinformation.cbic.gov.in/content-page/explore-act/1000304/1000001)
governs credit/debit notes; checking financial bounds is not legal authorization for
tax reduction. [IRP guidance](https://einvoice6.gst.gov.in/content/e-invoice-printing-process-mandatory-fields-modes-of-irn-generation/)
requires applicable invoices to carry an IRN. No turnover threshold is inferred from
master data and no unsupported e-invoice is issued. Professional approval, applicable
QR/signature/HSN requirements and correction/reporting deadlines remain release gates.

## Initial local verification and use

- TypeScript, lint, 110 unit tests, 34 isolated PostgreSQL integration tests and
  production API/frontend build passed. Schema generation reported no changes.
- All four browser workflows passed in installed Windows Chrome and Edge. Invoice
  coverage includes selection, quantities, discounts, exact GST totals, saved/reopened
  drafts, safe note text, disabled issuance, mobile overflow and A4 preview/print.
  Browser PDF capture of a synthetic 100-row draft confirmed multiple A4 pages;
  this is a test artifact, not a built-in PDF feature or a hardware printer test.
- Production policy rejects issuance without allocating a counter. Explicit test-only
  module spies exercised dormant finalization for numbering/concurrency/idempotency,
  audit rollback, immutable historical snapshots, authorized override provenance,
  full-credit reversal and deferred reconciliation failures. No bypass exists in
  production configuration or HTTP/UI inputs. No real invoice was issued.
- The additive migration was applied to local development after a custom-format
  PostgreSQL backup was copied to ignored `.local/backups/`. Its archive list was
  validated; no restore/recovery claim is made. Before/after aggregate identity,
  grants, business/classification and audit row counts matched; invoice tables were
  empty. Credentials, existing roles and customer records were not rewritten.
- Compiled API/readiness/OpenAPI/Origin/asset smoke checks passed. Native Windows
  service/ACL/LAN HTTPS/firewall/reboot, actual printers and remote CI remain untested.

Restart `pnpm dev`, sign in as owner, and open **Invoices → New invoice**. Choose
an active customer and reviewed catalog items; registration confirmation in Business
setup is required. Add quantities/discounts and supported facts, then **Calculate &
preview**, **Save draft** and **Print draft**. Existing non-owner grants are unchanged;
grant invoice and customer/catalog read permissions explicitly when needed.

## Continuation acceptance (2026-10-29)

The previously unfinished engineering features are implemented. Final verification
passed 115 unit tests, 38 isolated integration tests, full TypeScript/lint/build and
all five Chrome and Edge workflows. Browser checks include PNG upload and historical
printing, draft discard/reopen, responsive layout, A4 pagination and correction form
create/edit. Issued-control UI checks use explicit browser fixtures; integration
tests exercise actual transaction code with test-only release spies. No real invoice
or issued cancellation was enabled or executed.

Migration 0004 was applied after a fresh private custom-format backup. Existing-row
counts and fingerprints matched for business/financial/identity/credential/audit and
role-grant records, excluding the intentionally added schema fields. Existing grants
were unchanged; `invoices.cancel` must be delegated explicitly to non-owners. Schema
generation reports no drift. Compiled-app HTTP/readiness/OpenAPI/Origin and Edge
sign-in/health smoke checks passed. Archive listing was checked; restore, hardware
printer, native service/ACL/LAN HTTPS/firewall/reboot and remote CI remain unverified.

Restart `pnpm dev`. Upload/remove the logo under **Business setup**. Drafts offer
**Discard draft**; issued original invoices expose credit/debit and full-credit
actions, with editable correction drafts. Real issuance and issued cancellation
remain disabled until the professional compliance release. This gate does not mean
the remaining application features are unfinished. Scope exclusions (tax-only/rate
changes, IRP/return operations and unsupported supply scenarios) remain enforced.
