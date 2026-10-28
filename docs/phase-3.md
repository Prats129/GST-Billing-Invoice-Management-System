# Phase 3 — business setup, customers and catalog

Scope follows PROJECT_CONTEXT.md D5/D6/D14/D15: business profile with one active
regular domestic GST registration, customers, products/services, units, decimal
prices and reviewable tax classifications. Shared schema/API/UI for both editions.

Acceptance:

- Authenticated tenant/RBAC-protected profile and registration read/update.
- One active registration per organization; replacing its GSTIN preserves history.
- Customer/catalog create/read/update/search/pagination/archive/restore; tenant-unique
  codes; optimistic version conflicts; no destructive delete.
- Decimal-string prices/rates, HSN/SAC, unit and inclusive/exclusive pricing.
  Dated immutable tax revisions with separate review permission/actor/time/reference.
- Server validation, tenant FKs, constraints, bounded queries and transactional audits.
- Responsive workspace screens and authorization/concurrency/browser regression tests.
- Explicit reviewed migration, repeat/drift checks, build/types/lint/format/unit/
  integration/browser checks, incremental review coverage.

Choices:

- Reuse organization.read/manage for business setup; add customers.read/manage,
  catalog.read/manage and catalog.tax.verify. Existing non-owner grants are not
  automatically expanded on upgrade. Owners assign the new permissions explicitly.
- Structurally validate domestic PAN-based GSTINs and matching registration state
  codes. This does not verify checksum, registration status, taxpayer type or HSN
  existence online. E-invoice applicability is recorded as unknown/required/not_required;
  it is an operator input, not an automatic legal certification or an issuance permit.
- No seeded statutory rates. Catalog revisions hold operator-entered rate/category
  and effective date; verification is a recorded operator attestation. Classification
  changes create new unverified revisions. Taxable/nil/exempt setup only; no export,
  zero-rated or special schemes. Do not implement GST arithmetic or issuance here.
- Built-in units with quantity precision. No inventory/payment data, uploads or portal
  integration. Customer/catalog records are archived and restorable, not deleted.

Official setup references checked on 2026-10-28:

- [GST taxpayer search](https://tutorial.gst.gov.in/userguide/taxpayersdashboard/Search_Taxpayer.htm)
  supplies registration status/type, names and principal address.
- [GST HSN lookup](https://tutorial.gst.gov.in/userguide/taxpayersdashboard/Search_HSN_SAC_Tax_Rates.htm)
  supports classification research; format validation is not classification approval.
- [NIC state master](https://docs.ewaybillgst.gov.in/apidocs/state-code.html)
  informs domestic address choices; this is not a place-of-supply rule engine.

Phase 2 Windows service/LAN HTTPS/firewall/reboot and remote CI release gates remain.
No production invoice compliance claim is made in this phase.

## Local use and upgrade

Run `pnpm db:migrate` explicitly, then `pnpm dev` (or restart deployed services after
the controlled migration). Preserve the existing `.env`, MFA key and owner credentials.
Sign in as an owner and use Business setup, Customers and Catalog in the sidebar.
Existing non-owner Administrator/custom roles keep their old grants; an owner can
create a custom role with the new read/manage/review permissions and assign it.
Include organization.read so the member can open the workspace. Read and manage
permissions are separate; grant read access when a manager needs to browse records.

The API accepts `{version: 0, ...}` when creating a profile/customer/item and the
last returned positive version for updates/archive/restore/tax review. Stale writes
return 409. Customer/catalog codes remain reserved while archived. Searches are
literal and return at most 50 records plus hasMore; offset is bounded to 10000.
Classification history returns the latest 100 revisions. Name/description/kind or
classification changes require a fresh review; price-only edits preserve review.

Production runtime credentials must not own tables or disable triggers. In addition
to Phase 2 grants, Phase 3 needs SELECT/INSERT/UPDATE on business_profiles,
gst_registrations, customers and catalog_items, SELECT/INSERT on
catalog_tax_revisions/catalog_tax_reviews, SELECT on permissions and INSERT/SELECT
on audit_events. No DELETE on the new master-data tables and no UPDATE/DELETE on
classification revisions/reviews is required. Apply explicit grants after migration
using the separate migration/operator role; do not grant DDL or table ownership.

Unit codes/quantity precision are shared catalog metadata, not inventory tracking.
Before a commercial release, profile/registration and classification sources need
human verification, Phase 4 legal rules and later invoice/e-invoice issuance gates.

## Local acceptance (2026-10-28)

Implementation and local acceptance are complete. Production build, full workspace
and test TypeScript, lint, formatting and schema drift checks passed. Unit tests:
24/24; isolated DB/HTTP integration: 25/25; full browser workflows: 3/3 in both
Chrome and Edge. After the final directory error/retry fix, the affected business
workflow passed again in both browsers. Edge startup smoke and actual development
URL/sign-in/connectivity checks passed. Desktop and 390px phone screenshots were
inspected with disposable fixture data only.

The reviewed migration applied twice to the development DB; before/after hashes
confirmed existing organizations, users, memberships, roles, grants, MFA and owner
recovery records were unchanged. No existing credentials or encryption keys changed.
Detailed evidence, intermediate failures/fixes and retained services are recorded
in review-coverage.md. Remote CI and native deployment release gates remain untested.
