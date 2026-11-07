# Review coverage

## System Setup & Operations implementation (2026-11-07)

Editor follow-up: the script previously opened in an inferred TypeScript project
without Node types. Added a root `tsconfig.json` reusing the existing no-emit
test/tool configuration so the editor can discover it. The extra change to the
test configuration's script glob was redundant (the setup test already imports
the checker) and has been removed. App builds and checker behavior are unchanged.
Verified after removing the redundant glob: a fresh language server selected the
root configuration and reported zero script diagnostics; the no-emit compiler and
format checks passed. Reload the editor if its Problems panel retains old errors.

Batch 1 implemented: added an MFA-protected, read-only diagnostics endpoint and
Admin Operations card with stable codes and corrective guidance. Checks cover
worker enablement, operator connectivity, required routines, restricted-role
permissions/ownership and expected database-name comparison. Public trust/origin
configuration is distinguished from verified deployment health. Existing worker,
license, transaction, recovery and authentication behavior is preserved.

Added `pnpm setup:check`, which reuses the existing configuration validators and
inspects tool versions without changing files, running SQL or exposing values.
Added a current setup runbook and linked it from the Admin instructions. No real
environment files, migration history, secrets or production resources changed.
The compatibility configuration endpoint remains unchanged; its historical
`saasConnected` flag is explicitly documented as configured-only.

Verification: all 300 unit tests passed (including 10 new diagnostic/setup tests),
all 12 platform integration tests passed, and all three Admin Chrome browser tests
passed against fresh builds. Real PostgreSQL checks cover a restricted role,
missing EXECUTE permission, superuser rejection and expected-target comparison.
Browser assertions cover refresh and a failed diagnostics request without losing
the existing Operations list. Workspace/test type checks, all application builds,
lint and repository formatting passed. `pnpm setup:check` also passed locally,
reporting only syntax/tool status rather than database/deployment readiness.

Tests used a new disposable PostgreSQL container, with no customer volumes or
real credentials mounted. No native installation, Windows service, firewall,
certificate trust, reboot/LAN or production hosting acceptance was performed.
Batch 2 and subsequent roadmap batches remain pending. The expected database-name
check is optional and advisory; it does not verify server identity, API edition or
origin, and diagnostics do not alter existing operation authorization/execution.

## Platform Admin App implementation (2026-11-05)

- Batch 1 complete: separate owner-only admin UI/API and platform database/migrations, private bootstrap/recovery, mandatory MFA, rotated opaque sessions, step-up confirmation and isolated customer cookies. Shared crypto/verifier extraction preserves customer wrappers; no signing code or private keys are loaded by the portal.
- Batch 2 complete: searchable/paginated online/offline directory, stable detail routes, verified SaaS links, durable provisioning, hashed 24-hour setup tokens and existing-user ownership acceptance without password replacement. Pending setup and last verified hosted observations remain distinct.
- Batch 3 complete: exact-date/INR agreements, partial receipts, balances and linked refunds/reversals; immutable receipt history and versioned void/replacement. Concurrent receipt checks reject overpayment. Payments do not activate entitlements.
- Batch 4 complete: immutable signing requests and CLI-compatible exports, trusted signature/binding/history/request validation, verified download and separate offline delivery/operator reports. Publisher register and encrypted offline signing custody remain external authorities.
- Batch 5 complete: restricted SaaS operator routines, durable command receipts, leased ordered retries, ambiguous-commit reconciliation and a separately enforced write pause. Owner access never grants platform authority. Runtime-role provisioning rejects ownership/inheritance, customer-data privileges and protected-ledger mutation grants.
- Batch 6 verified: 283 unit tests passed; complete integration run passed 78 tests with the opt-in installation-container case skipped, then that case passed separately. The added role-provisioning check passed in the final 12-test platform/backup rerun (80 distinct integration checks verified overall). All 17 customer/admin browser tests passed in Chrome on Windows. Production builds, full workspace/test TypeScript, repository lint, formatting and whitespace checks passed. Desktop/mobile portal screenshots inspected.
- Distribution evidence: assembled the actual compiled customer runtime and inspected 145 packages / 5,918 files. Shared security was included; admin applications, issuer directories and private-looking key/environment files were absent. This was an unsigned local application assembly, not an approved Windows installer or native deployment.
- Failures resolved: explicit Node types in the new package; active-owner accepted-at invariant during provisioning; exact accessible select labels; missing pnpm context in the direct regression runner; and historical recovery fixtures that removed only one migration instead of building genuine Phase 5. Fixture connections are explicitly closed before cutover. Nine focused recovery/update tests and the final full integration suite passed; current startup remains strict while independently bound retained-schema checks support the prior reviewed schemas.
- Setup and restore runbook: [Platform Admin](platform-admin.md), with separate runtime/operator environments, deliberate worker enablement after reconciliation and a real encrypted PostgreSQL dump/restore drill. No real workspace records, production database, signing key, license or Windows service/trust settings were created or changed. Hosting, production TLS/key custody and postponed native Windows acceptance remain external release gates.

## Record detail routes (2026-11-05)

- Batch 1: Preserve existing hash navigation and add invoice, customer and catalog detail URLs. Direct record loading uses organization-scoped endpoints, independent of directory pagination. Customer/catalog editors become pages; invoice pickers remain dialogs.
- Retain workspace unsaved-change confirmation for route changes and add a reload/close warning for dirty editors. Loading failures remain on the requested record URL with back/retry controls.
- Batch 2: Web build, TypeScript and lint passed. Initial browser run passed customer/catalog refresh and unsaved history checks; it exposed a stale invoice list on return from a detail page. Fixed list loading to refresh when returning to list routes and avoid background directory requests on detail pages. Updated old modal/reload test expectations.

- Batch 3: Updated the synthetic correction fixture to support GET by its new detail URL. Removed obsolete view-only navigation bookkeeping and retained page-title focus on detail-route changes.
- Final verification: all 15 browser tests passed in Chrome on Windows, including real disposable-database customer/catalog refresh, customer Back/Forward and unsaved cancellation, invoice draft and finalized-record refresh, issuance and printing, correction controls, MFA/entitlements, mobile layouts, invalid IDs and unavailable-record retry. Production web build, web/test TypeScript, repository lint, repository formatting and whitespace checks passed. Browser tests used isolated test databases; no real workspace records were changed. No schema, backend authorization or dependency changes were needed.

## Ordinary invoice release after owner-confirmed CA review

The project owner confirmed on 2026-11-05 that their CA reviewed and approved the
tax calculations, rounding, invoice fields and numbering, and authorized moving
forward. This records the owner's statement, not an independently verified review
report or a government certification. E-invoice integration remains explicitly on
hold. Enabling only the existing supported ordinary domestic invoice scope;
credit/debit note issuance and issued cancellation retain their release gates.
Calculation/rounding semantics and tax rates are unchanged; the engine patch
version records the release-metadata change. Policy, UI and finalization
regressions are in progress. No real customer invoice will be issued by tests.

First batch: engine and release-policy unit checks passed (86 tests). Replaced
hardcoded pending-approval preview/UI messages with document/applicability-aware
blockers. Ordinary finalization tests no longer use a release spy; retained spies
are limited to exercising unreleased correction/cancellation internals. Added
negative HTTP checks for unknown/required e-invoicing, correction-note issuance
and missing finalize permission. Real browser finalization/printing is added to
the existing draft workflow. Full build and integration/browser checks follow.

Second batch: production API/web build passed. All 16 invoice integration tests
passed against a disposable database, including ordinary issuance without policy
spies, consecutive concurrent numbering, retry/idempotency, transaction rollback,
historical immutability, permission rejection and no allocation for e-invoice or
unreleased note/cancellation gates. The initial compiler check caught database
document types represented as strings; the release predicate now safely accepts
stored strings and denies every type except `invoice`, including unknown types.
Web/test TypeScript, repository lint and formatting passed. Browser issuance and
the final unit/renderer checks are continuing. No schema migration is required.

The first browser pass correctly kept finalization disabled because the historical
browser business fixture left e-invoice applicability unassessed. Updated only
that synthetic business setup to explicitly select `not_required`; no real
business profile is changed. The unknown/required HTTP gates remain verified.
Final calculation/contract/renderer/frontend unit checks passed (97 tests).

The browser continuation also exposed a test-navigation issue: the editor and
invoice list share a hash, so navigating to that same URL could retain the old
cancelled editor. The test now explicitly reloads the list after API fixture
creation. The real UI issuance flow then passed: the button requires a saved draft
and fresh preview, finalization returned `INV/2627/000001`, the numbered Tax invoice
copy contained no draft heading, and the immutable print copy reopened after
reload. The ordinary issuance request uses the real policy and API, not mocks.

Completed verification: production package/API/web builds, 97 selected financial,
contract, renderer, API-policy and frontend unit tests, all 16 invoice integration
tests and all 14 browser regressions passed. Final web/test TypeScript, repository
lint, formatting and whitespace checks passed. Browser checks include actual
ordinary finalization and numbered historical printing, plus the existing draft,
PDF pagination, correction-dialog, entitlement, identity/MFA and theme workflows.
Database tests use randomly named disposable databases that are cleaned up; no
development/customer invoice was issued and no business applicability or grants
were changed. No schema, dependency or deployment changes are required. Rebuild/
restart the development app, save a supported draft and calculate a fresh preview
before finalizing. Required/unknown e-invoicing and issued notes/cancellation stay
blocked as documented. Native printer/Windows installer and commercial deployment
acceptance remain outside this locally verified release change.

## Dark sidebar: match the breadcrumb header

Replaced the lighter slate sidebar with the shared surface color used by the
breadcrumb header. Dark navigation now matches the header automatically instead
of maintaining a separate shade. Light mode retains its neutral sidebar.
The production build, all seven UI browser tests (including six-palette text
contrast), formatting and whitespace checks passed. Inspected the dark desktop
screenshot to confirm the header and sidebar use the same surface color.

## Dark sidebar: clearer separation from page content

Changed the dark sidebar from near-black to a lighter neutral slate so it is
visibly distinct from the deep page background and raised content cards. This
uses the shared navigation token for expanded, collapsed and mobile menus;
light mode and account accent choices are preserved. Added a collapsed dark
navigation screenshot to the existing browser coverage. Build, six-palette text
contrast checks, navigation regressions and screenshot review are pending.

Verified the production build and all seven existing UI browser tests, including
sidebar text contrast for all six mode/accent combinations. Inspected expanded
and collapsed dark screenshots: the slate menu is clearly separated from the
deeper page background. Mobile navigation checks use Chrome viewport emulation.
Formatting and whitespace checks passed. Existing staged work is preserved.

## Sidebar: neutral surfaces with selective accent

Replacing the fixed dark teal sidebar with neutral off-white (light mode) and
charcoal (dark mode). The selected link uses a subtle accent tint and accent text;
the full menu no longer carries a brand-color fill. Sidebar labels, account row,
logo tile, separators and scrollbars use theme tokens in expanded, collapsed and
mobile layouts. The sign-in illustration retains its separate dark backdrop.
Existing account accent preferences still control highlights. Build, contrast,
responsive screenshot and browser regression verification are pending.

The production build and all seven UI browser regressions passed. Extended the
six-palette contrast check to measure actual sidebar branding, normal/selected
links and account text against their rendered backgrounds (minimum 4.5:1).
Color measurements handle CSS color-mix output through the browser canvas.
Inspected light, dark and collapsed desktop screenshots; mobile navigation and
settings interaction checks passed using Chrome viewport emulation. Existing
staged theme/API/database work is preserved; this follow-up changes only sidebar
styles, browser coverage and this checkpoint.
Web/test TypeScript, lint for the changed browser test, formatting and whitespace
checks passed. No new dependencies or preference/database changes were needed.

## Account appearance: light/dark themes and accent colors

Implementing per-user appearance preferences: system/light/dark modes and
curated teal/blue/violet accents. Preferences belong to the authenticated user,
persist in the database and are returned by session APIs. The mutation uses
existing authentication, MFA/password gates, Origin and CSRF checks, accepts no
target-user ID and does not refresh organization data or discard invoice edits.
The settings UI and semantic color palette, migration and verification are in
progress. Printed invoice documents retain their independent paper styling.

The complete build and all 13 browser tests passed, including persistence through
reload/new login, separate-user defaults, automatic system-mode changes, failed
save/retry and preserving an unsaved invoice during appearance changes. Inspected
dark desktop/mobile settings and dark sign-in screenshots. TypeScript, lint and
repository formatting passed. The first integration invocation passed the new
preference checks but the host-CLI test requires the documented pnpm script
environment; rerunning through that script with Docker backup tools enabled so
runtime-access checks are exercised instead of skipped.

The corrected integration invocation passed all 20 security/runtime-access tests,
including authenticated-user isolation, invalid/forged preference payloads,
CSRF rejection, password-change gating and persistence across fresh sessions.
All six light/dark accent combinations passed browser measurements of normal
text, headings, input text, primary/secondary actions and status labels against
their rendered backgrounds (minimum 4.5:1). Migration 0006 was generated from
the schema with its journal/snapshot; defaults preserve existing users.

Completed: applied the reviewed migration to the verified loopback `gst_dev`
development database using its migration identity. No customer records were
edited. Frontend/contract unit checks passed (8 tests); security/runtime-access
integration checks passed (20 tests); the complete existing/new browser suite
passed (13 tests), followed by the added six-palette contrast regression (1 test).
The API/web build, web/test TypeScript, repository lint, formatting and whitespace
checks passed. README documents the account settings path and upgrade migration.
No dependencies, signing/installer changes or new organization permissions were
introduced. Dark-mode screenshots were inspected in Windows Chrome; mobile checks
use viewport emulation. This checkpoint completes the requested account themes.

Post-shutdown integrity check: all implementation files and migration metadata
are present and staged. No unstaged edits were present when resuming. A fresh web
production build and all seven database-independent browser tests passed,
including palette contrast, navigation, mobile settings and unsaved-edit guards.
Staged/working-tree whitespace checks passed. No implementation files were
rewritten and no migration was repeated; earlier database-backed results above
remain the prior verified run. Only this continuation checkpoint was appended.

## UI follow-up: consistent spacing and sidebar details

Added a subtle inset divider below the sidebar brand, matching the existing
account-area separator. Tightened the bottom account row while retaining its
44px minimum height, and replaced the rotated navigation chevron with a
three-dot account-menu indicator. Reduced shared card, table, form, dialog,
invoice, overview and sign-in spacing, with smaller mobile gutters. Input sizes
and typography are preserved; printed invoice documents use their separate
renderer and are not restyled. Added breathing room above customer/catalog
search tools so controls no longer touch the card edge. Existing keyboard,
focus, modal and permission behavior is retained. Build, static checks, browser
regressions and desktop/mobile screenshot inspection are pending.

First complete browser pass succeeded (12 tests). Screenshot review exposed
stacked mobile spacing: desktop cell padding was overriding the mobile card's
zero-padding cells. Corrected that cascade so mobile rows have one 16px gutter
and the existing grid gap, rather than padding each child again. Removed the
large-screen generic surface-padding override so directory cards retain their
flush table edges. Final build/UI rerun includes a wide-screen customer capture.

Final production build and all 12 browser regressions passed, including real
login/RBAC, customer/catalog workflows, invoice calculations, marked print/PDF
previews, correction dialogs, entitlement read-only behavior and MFA. Web/test
TypeScript, repository lint, formatting of changed files and whitespace checks
passed. Inspected expanded/collapsed navigation, account menu/settings, mobile
catalog/settings, invoice and 1680px customer screenshots. Desktop cards generally
use 20px gutters and mobile cards 16px; tables use compact 12px vertical padding
on desktop and a single padded card row on mobile. Mobile verification is Chrome
viewport emulation. Existing staged changes are preserved; no changes were staged
or committed during this follow-up.

## UI follow-up: compact top spacing

Reduced the space above and below the sidebar brand in both expanded and
icons-only modes, including the gap around the collapse control. Reduced the
main content's top padding to 20px. Menu item sizes, horizontal gutters and
account settings remain unchanged. The production build and all six existing UI
browser regressions passed, including mobile overflow and settings behavior.
Inspected expanded and collapsed desktop screenshots to confirm the tighter
spacing. Formatting and whitespace checks passed. Only the focused workspace
stylesheet and this review checkpoint changed; existing staged work is preserved.

## UI redesign: focused workspace and account settings

Started the approved coherent redesign. Reusing existing business/security APIs
and native dialog focus handling. Main navigation is being reduced to daily
work plus a permission-aware Business settings entry; personal security/status
move to an account menu and modal. Desktop collapse is a persistent, non-secret
device preference; mobile retains labelled drawer navigation. Account settings
have separate password/MFA/session actions and unsaved-input/recovery safeguards.
Existing hash routes remain supported, including legacy account links.

Removed duplicate daily-page headings/action bars via a shared page-action slot.
The overview now reads up to five real invoice summaries with loading/retry/empty
states, rather than displaying a matrix of navigation cards or invented metrics.
Implementation and responsive styling are in progress; no backend/schema, tax,
entitlement or authorization changes are introduced.

First UI pass verified collapse persistence, keyboard tooltips, one page-action
area, complete business saves, unsaved-change cancellation, account menu/tab/Escape
focus behavior and the full-screen mobile settings handoff. One legacy-route
test expected the overview after closing a modal opened from Customers; corrected
that expectation because preserving the current page is the intended behavior.
The other five new browser tests passed. The full real API/database suite and
the corrected UI suite are now running against disposable test databases.

Added explicit guards for unsaved invoice/business changes on navigation,
organization changes and access refresh. Opening/closing settings preserves the
mounted editor; account mutations warn before session refresh can discard that
work. Account forms protect unsaved credentials and incomplete authenticator
setup, and recovery codes must be acknowledged before leaving settings. No
credentials, draft contents or permissions are stored in the collapse preference.

Resumed after the unexpected PC shutdown. The saved implementation and original
staged changes are present; the final verification process did not survive.
Repeating the production build, static checks and browser regressions against the
saved files. Docker was stopped after reboot, so database-backed verification
requires restoring the existing local container. No installer or release changes
are part of this UI batch.

Completed verification after resuming: the web production build, web/test
TypeScript checks, repository lint and formatting passed. Both frontend API unit
tests passed. All 12 browser regressions passed in installed Chrome: six real
API/database tests covering identity/RBAC, business/catalog/customers, invoice
drafts and marked print previews, correction notes, expired entitlement reads and
MFA; six synthetic-API tests covering the redesigned navigation, collapse
persistence, keyboard focus, permission filtering, account modal/mobile handoff,
unsaved-input safeguards, retry and unavailable browser storage. Database tests
used randomly named disposable databases and completed their cleanup.

Inspected final desktop, collapsed-sidebar and mobile-size settings screenshots.
The icon-rail focus outline is visible, labels are readable, and opening settings
locks background scrolling while preserving unsaved invoice content. Desktop
collapse uses a 72px rail; business administration is grouped under Business
settings, and security/status are accessible from the bottom account menu.
Existing staged work was preserved; no files were staged or committed during
this continuation. Mobile verification uses Chrome viewport emulation, not a
physical phone. Windows installer/service behavior is outside this UI change.
Vite/Vitest child-process checks required execution outside the sandbox after
the sandbox reported spawn EPERM; the approved reruns passed.

## UI follow-up: right-side content spacing

Reduced the desktop right gutter from 36px to 24px, and from 24px to 20px at
the narrower desktop breakpoint. Removed the workspace's centered maximum-width
cap so wide windows do not add another empty gutter. Existing readable text/form
limits and the mobile 16px gutter remain. The production build, all four UI
browser tests, formatting and whitespace checks passed.

## UI follow-up: wider sidebar and hover scrollbar

Increased desktop navigation width to 280px (260px at the narrower desktop
breakpoint). On mouse devices the scrollbar thumb is transparent until the
sidebar is hovered or a navigation link receives keyboard focus. The gutter
stays reserved to avoid label movement. Touch devices retain visible scrolling;
forced-colors mode retains system styling. Existing mobile drawer sizing and
scroll functionality are preserved. The production build and all four existing
UI browser tests passed, including shorter-window sidebar scrolling and mobile
overflow checks. Formatting and whitespace checks passed; the last build refresh
includes the explicit forced-colors hover/focus override.

## UI follow-up: sidebar scrollbar

Replaced the screenshot's bright native navigation scrollbar with a thin muted
thumb on a transparent dark track, including hover/focus contrast and a WebKit
fallback. Native scrolling stays enabled; forced-colors mode keeps system colors.
The existing desktop navigation browser check now runs at 720px viewport height
and verifies wheel scrolling reaches the last menu item. Browser verification
and screenshot inspection passed. The web production build and all four UI
browser tests passed, including actual wheel scrolling to the last navigation
link in a 720px-tall desktop viewport. Previous staged UI changes are preserved.

## UI/UX: organize everyday work and administration

Started the requested workspace redesign after reviewing navigation, overview,
business setup, invoice editor and existing browser coverage. The old sidebar
mixed billing, master data and administration in one flat list; the overview
prioritized permission matrices over daily tasks. Centralized permission-aware
navigation now groups Sales & billing, Business & team and Your account. A new
task-focused overview, related-page links, distinct document/catalog icons and
scoped responsive styles replace the access-heavy landing page. Permissions
remain available in a collapsed disclosure. Existing route names are retained.

Business setup now has distinct identity/address/GST/bank fieldsets in the same
save form. Invoice editing has focusable section jumps and a desktop sticky
summary; required fields stay visible and existing compliance gates remain.
The web production build passed. Browser interaction, responsive screenshots,
form-payload preservation, restricted navigation and final checks are in progress.
Browser layout tests use synthetic API responses and never modify real data.

First browser pass succeeded for all four tests: grouped desktop navigation,
invoice section focus, complete business save payload, browser Back, mobile menu
and dialog dismissal, viewport overflow and permission-filtered links/direct
routes. Inspected actual desktop/mobile screenshots. Visual inspection caught
legacy CSS hiding the newly grouped business fieldset legends; the scoped styles
now restore visible section titles. Full-page captures now reset scroll before
capture so sticky sidebar/summary placement is represented correctly. Final
browser rerun and compiler/lint/format checks follow. Existing issuance, printing,
read-only entitlement and API/security logic have not been changed.

The existing development PostgreSQL container is available. Expanded verification
to the real authentication/business/invoice browser suite using only randomly
named disposable databases and fixture users. The first run reached employee
login and exposed another obsolete organization-heading selector after the home
redesign; the selectors now target the organization context and the named main
navigation to avoid ambiguity with new task links. This is a test adaptation,
not an authorization change. The full rerun is in progress. Frontend API unit
tests passed (2), as did web/test TypeScript and lint before the latest small
keyboard-accessibility adjustment. The skip link now focuses main content
without changing the hash route, and access disclosure has a visible affordance.

Final browser regression passed all 10 tests in installed Chrome: six existing
real API/database tests (identity/RBAC, business/catalog/customers, invoices and
print previews, correction documents, entitlement read-only behavior and MFA),
plus four new synthetic-API UI/navigation/accessibility tests. Real database work
used randomly named disposable databases, which the suite cleaned up; development
and customer records were not modified. Desktop/mobile viewport screenshots were
inspected after the final layout change, including visible fieldset headings.
Mobile checks are browser viewport emulation, not physical-device acceptance.

Web/API production builds, web/test TypeScript, frontend API unit tests (2) and
lint passed. Final repository formatting and whitespace checks also passed.
No dependencies, schema, tax rules, licensing gates or server authorization were
changed. The scope is workspace navigation, home, shared visual hierarchy and
business/invoice form organization. Existing hash routes and business actions
remain available. Previous release/signing work is untouched; no staging/commit
was performed during this UI task.

## Phase 6: vendor review and production signing

Started the requested actual vendor approval/signing work. Existing publisher
commands and encrypted-key import already exist; this is not a new product phase.
Read the exact downloaded PostgreSQL notices and archive entries, plus current
official upstream licenses and Windows SignTool documentation. The candidate
contains libiconv/libintl/libwinpthread and an LGPL notice but has no verified
matching source/build-material delivery record. Its bin directory also retains
wxWidgets libraries whose notice coverage needs explicit review. Node/WinSW MIT
license texts alone do not approve those PostgreSQL dependencies.

Found and fixed a concrete packaging gap: compiled frontend dependencies such as
React are not part of the API's production dependency graph, so their complete
license texts were missing. Assembly now adds a separate frontend license
inventory and full notice files without shipping frontend node_modules. Missing
license text fails closed. Regression verification is in progress. The previous
unsigned candidate remains preserved and unapproved; no production key or
approval receipt has been fabricated.

Review checkpoint: EDB issue 733 supplies a vendor-published SHA-256 matching the
18.6-5 source ZIP. Issue 743 identifies gettext 0.19.8/libiconv 1.19 and clarifies
that winpthreads is permissive; its exact revision/original notices and dependency
build records remain unresolved in the reviewed evidence. The source catalog's
libiconv 1.15 entry cannot substitute for the shipped 1.19 library. These findings
are recorded in windows-artifact-review.md with direct upstream sources.

The WinSW NET461 release-tag build merges log4net 2.0.12 and YamlDotNet 8.1.2.
Downloaded their version-matched LICENSE files and log4net NOTICE to new local
filenames and saved artifact-review-supplemented.json as a draft, not approval.
Original review/observations/candidate remain untouched. Local WinSW Authenticode
inspection reports NotSigned. No current-user code-signing private certificate
was found; SignTool is not on PATH. No vendor issue/comment/email was sent.

User selected the project owner/developer as release-key owner and dedicated
encrypted offline storage as custody. The mounted storage path is awaiting user
input; no passphrase, private key or production certificate was requested in chat.
signed-releases.md now records the concrete encrypted-key handoff and correct
signing order: sign first-party helpers in a private publisher checkout, prepare
and smoke a new candidate, then seal both inventories. No existing candidate's
report is rewritten to allow modified code to execute.

All 15 targeted bundle/release-publisher regressions passed, including the new
missing-frontend-notice case; test TypeScript and lint passed. Actual assembly
completed in a new private directory:
`C:\Users\Lenovo\AppData\Local\GST-windows-candidate-vendor-review-20261104`.
Its unsigned bundle contains 5,930 files, 132,532,936 bytes and 144 runtime
dependency packages. The frontend inventory preserves React, ReactDOM, scheduler
and Zod full license texts without shipping frontend node_modules. Supplemental
WinSW notices remain in the separate review draft; this candidate still uses
the original unapproved vendor review. Its real isolated API/frontend/assets,
native-addon and Origin smoke passed; dummy-database readiness returned 503 as
expected. Final formatting and whitespace checks passed. No real database,
service installation, Authenticode signing or production Ed25519 signing ran.

The user confirmed the dedicated encrypted offline storage is not prepared yet;
no production key is generated until that actual custody location exists.
Actual approval/signing remains blocked by the unresolved dependency distribution
materials/notice coverage, the unprepared encrypted offline storage and a
publisher-owned Windows code-signing certificate. This is a concrete external
handoff, not another implementation phase. Do not create a licensesReviewed:true
receipt, silently weaken signing gates or use test credentials to declare release.

## Phase 6 continuation: actual Windows bundle assembly

Started publisher-side assembly of a self-contained Windows application and the
existing installer helpers, with nested application/bundle signatures and vendor
input verification. No service installation, global toolchain change or production
key generation is authorized by this work. Existing local PostgreSQL cache is an
older beta package and is excluded. Official Node 24.22.1 publishes a Windows x64
ZIP checksum; the WinSW 2.12.0 release asset API exposes no digest. EDB's official
18.6 Windows ZIP link is being checked. Cached/downloaded bytes are not silently
promoted to independent approval. Work and local verification are in progress.

Continuation checkpoint: production builds passed. Official Node 24.22.1,
PostgreSQL 18.6-5 and WinSW 2.12.0 inputs and complete notices are retained under
the ignored `.local/windows-bundle-inputs-20261104` directory. Node's ZIP matches
its published checksum. PostgreSQL's server/tools-only ZIP was derived without
running vendor executables; static ZIP bounds, paths, required executable hashes
and PE architecture inspection passed. Observed PostgreSQL/WinSW hashes are not
independent approval. No approval receipt or production signing key was created.

New tests cover dependency-version conflicts, missing dependencies, private-file
rejection, output preservation, migration binding, approval gating and nested
test signatures. Initial assembly correctly refused the shared E: drive ancestor
ACL. Partial outputs are retained; private-profile candidate assembly and the
updated tests are in progress. Windows Temp also has an additional worker access
grant, so these fixtures use a private profile parent without mocking ACL checks.
No service, task, firewall, certificate trust or customer database was changed.

Private candidate assembly completed at
`C:\Users\Lenovo\AppData\Local\GST-windows-candidate-20261104\bundle`:
5,925 ordinary files, 132,527,445 bytes, 144 dependency packages. The build report
outside the bundle explicitly lists independent vendor approval, Ed25519 release
signatures, Authenticode distribution signing and native acceptance as pending.
Original E: partial outputs are preserved. Five targeted tests passed; two more
cases now cover redirected package contents and optional/cyclic dependencies.
Test TypeScript and lint passed. The first full run exposed default five-second
timeouts for PowerShell ACL checks under concurrent worker load; these native
fixture tests now have a bounded 30-second timeout. Final regression and isolated
candidate startup checks remain in progress.

The real candidate smoke passed API startup, frontend/assets, native Argon2
loading and Origin rejection with ESM/CommonJS resolution restricted to the
assembled app. Its deliberately unavailable dummy database reported 503 as
expected; no real database or installer/service acceptance is claimed. Estimated
inner/outer signed-envelope sizes are below the existing 2 MiB limit. All seven
new tests passed separately. The unrestricted full regression run was interrupted
after native maintenance/ACL timeouts; a two-worker rerun is being reviewed.

Final publisher checks: all eight new bundle tests pass, including rejection of
a changed unsigned runtime before execution. Production builds, test TypeScript,
lint and repository formatting passed. The bounded two-worker full suite finished
with 276 passed and one existing maintenance scenario timing out at 30 seconds;
no assertion failure was reported. That scenario runs many real PowerShell ACL
checks. Its Windows-only test budget is now 90 seconds (non-Windows stays 30;
production command timeouts and security checks are unchanged). All seven
maintenance tests are being rerun with that bounded budget. No tests were skipped
or native checks mocked to hide the timeout.

The maintenance rerun passed all seven tests with real temporary-file/ACL checks
and mocked machine effects. Together with the full run's other passing files and
the final eight bundle tests, all 278 distinct unit cases have passed across
these runs; a fresh combined all-green run is not claimed. Final TypeScript and
lint passed after the last test changes; formatting and staged/unstaged whitespace
checks passed. The unsigned candidate and prior staged changes are preserved.
Publisher tooling/local candidate work is complete; independent artifact and
redistribution approval, production Ed25519 signing, Authenticode distribution
signing and disposable Windows host/client acceptance remain external blockers.
No privileged installer execution or real-database acceptance occurred here.

## Phase 6 continuation: interrupted uninstall and retained-data repair

Started the explicit inspection/recovery and repair/reinstallation workflow.
Initial installation remains new-root-only. Repair must retain database identity,
schema, owner credentials, settings and backup keys; it must not initialize a
cluster, migrate, provision an owner or adopt unknown registrations. Maintenance
uses the existing shared lock, with fresh evidence and fenced native execution
before recovering an interrupted operation. Native effects will remain mocked;
the postponed Windows host/client acceptance is not run on this laptop.

Implemented distinct uninstall/repair intents under the existing maintenance
lock, read-only inspection, exact inspection confirmation and explicit recovery.
Native execution holds an exclusive file handle and checks a rotating permit;
live owners, busy guards and superseded delayed commands are refused. Recovery
preserves original/torn journals, records each attempt and archives only the
verified resolved lock. An interrupted recovery can be retried with fresh evidence.

Repair restores only the signed installed application/version/schema and original
approved tool archives. Damaged files are retained with target/hash receipts;
data/configuration/key paths are excluded from the replacement primitive. Service
and backup registrations are restored only when absent or proven owned. PostgreSQL
restarts with ExistingClusterOnly; a trusted read-only verifier checks cluster
system identifier, actual data directory, migration history and owner/runtime
access. No migration, initial owner provisioning or credential/key reset occurs.

First verification passed 14 targeted unit tests (seven new durable maintenance
cases plus existing installer preflight), the isolated fresh-container database
test including new retained-identity/read-only assertions, and the real temporary
file guard/fence/replacement test with all machine effects mocked. The first
atomic-replacement fixture run was denied by the sandbox; the same bounded test
passed outside it. Workspace/test TypeScript passed before the latest tests;
lint, full regression, additional native orchestration and final build/smoke
verification remain in progress. No live service, task, firewall or trust change.

The full unit suite passed 267 tests in 37 files. Repair preflight additionally
checks missing/changed keys, retained identity, redirected runtime, exact release,
approved tool archives and independent source storage. It caught the initial
Windows task receipt's uppercase SHA-256 format; comparison now accepts that
format without rewriting the receipt. Mocked full repair/reinstall sequencing
passed missing-service restoration, existing-only PostgreSQL, read-only/tree
verification, HTTPS admission ordering and failed-readiness isolation. Real
temporary-file tests also verify that missing cluster evidence is never recreated
and that redirected writable directories/unexpected writers are rejected before
permission grants. All machine mutations remain mocked.

Final integration review found release staging uses `gst-release-<six characters>`
roots. Repair and backup selection now accept those protected direct children of
`releases` as well as semantic-version directories, preserving the selected state
rather than guessing a path from its version. The installer service backend now
enforces the authoritative root/operations journal parent and original runtime,
node and backup identities, preventing alternate configuration from bypassing
repair/uninstall exclusion. Those mocked native tests and all 12 latest installer/
repair preflight tests passed. TypeScript, lint, formatting and production builds
passed before this final integration adjustment; final API compilation, smoke and
documentation checks follow. No schema, UI, license/tax gate or staging changed.

Final review also bound repair to the exact original installed file inventory,
not only version/schema. Assisted updates now retain authenticated original and
target manifests for repair after update or rollback; initial repair uses the
protected initial inventory. Republished same-version application changes are
refused, preserving the existing maintenance/update boundary. Missing old
inventory evidence remains refused. Additional preflight cases verify both
initial and post-update inventory binding; final shared-adapter regressions are
being rerun after this integration change.

Final API and test TypeScript, lint, repository formatting, production package/API/
frontend builds and the compiled frontend/assets/API/real-database/OpenAPI/Origin
smoke passed. The real isolated update/recovery regressions passed all nine tests
after the inventory-receipt change. The full unit run exposed two outdated
fault-injection mocks for original-release verification; corrected the mocks,
asserted both saved inventories and reran all three affected tests successfully.
The final full unit rerun passed all 270 tests in 37 files. All 27 PowerShell scripts parse; safe
repair file/guard/cluster and mocked lifecycle/backup/update/deployment tests pass.
Read-only Windows service-SID derivation and self-process creation-time probes
also passed outside the sandbox after its WMI access denial. No service, task,
firewall, account, certificate trust, production key, customer data or Git staging
was modified. Actual clean install/uninstall/repair/reboot/LAN/power-loss and
distribution signing acceptance remain postponed, not certified by these checks.

## Phase 6 continuation: initial Windows installation and preserving uninstall

Started the initial installer lifecycle against signed, inventory-verified inputs,
dedicated service/database identities and protected installation state. Official
vendor review identified a real WinSW compatibility defect: stable 2.x uses
serviceaccount/domain + user, whereas the prototype emitted username. Correcting
that contract is part of this batch. No unsigned cached executable is approved,
no runtime major is changed and no privileged deployment is run on this laptop.
Actual Windows install/LAN/reboot and redistribution/signing acceptance remain
external gates; code and safe local verification are in progress.

Resumed after the connection interruption, preserving all existing edits. Added
the explicit signed-bundle host entrypoint, private cluster initialization,
reviewed runtime grants, owner provisioning, encrypted backup registration,
installed-state selection and data-preserving uninstall. Initial network
admission is protected by a temporary explicit inbound block, process/listener
identity checks and a pinned real HTTPS probe. Uninstall verifies exact root,
service accounts/wrappers, task definition/principal and firewall filters;
interrupted shared maintenance blocks it. It never deletes retained files/data.
Backups now optionally follow the protected installed-state pointer; updates
grant the dedicated backup identity read access to the selected release/state.

First checks: all workspace/test TypeScript and lint passed before the new tests;
existing mocked update/deployment/task suites and the new preserving-uninstall
decision suite passed. Five installer-preflight tests passed with external
effects mocked. The fresh-container PostgreSQL test caught a runtime-policy
validation-before-CONNECT ordering error; corrected the shared helper/caller
ordering and rerunning. Native effects remain unexecuted. Final integration,
regression, build and documentation checks are in progress.

The corrected fresh-container PostgreSQL initialization test passed, including
wrong-directory/equal-password/unexpected-role refusal, migration, actual runtime
authentication, audited identity, no runtime DDL and repeat refusal. The test
container/anonymous volume was removed after checking its unique ownership label;
the development database was not used for initialization. Existing isolated
runtime-policy integration tests passed (4), followed by update-host and recovery
switch regressions (9). The full unit run passed 253 tests in 36 files; the final
changed installer/journal/native-adapter subset passed 17 tests, including new
cross-operation uninstall exclusion and input-change/entrypoint refusal.

Real harmless ZIP extraction/refusal checks and mocked installer/uninstall,
installed-backup selection, service/update and deployment suites passed. The
Windows Task Scheduler XML parser accepted the definition in memory; no task was
registered. All 24 PowerShell files parsed. Native installation/deployment was
never run. Workspace/test TypeScript, lint, formatting and production package,
API and frontend builds passed. Two cold smoke attempts exceeded the existing
startup retry window; a longer sanitized probe confirmed compiled API startup
and HTTP 200. The subsequent normal smoke passed frontend/assets, API, real
database readiness, OpenAPI and Origin rejection. No application, dependency,
environment or timeout change was made to hide the slow-start observation.

The initial installer and preserving-uninstall command are now documented in
windows-installation.md. Approved signed vendor payloads, Authenticode signing,
actual VSA/NTFS/firewall/job/LAN/reboot/power-loss acceptance, retained-data
repair/reinstallation and interrupted-uninstall reconciliation remain open.
Uncertain operations preserve their evidence/lock; they are not automatically
resumed or adopted. This is not a claim that Phase 6 or the commercial installer
is complete. No UI, product license/compliance gate, production key, customer
database or Git staging was changed.

## Phase 6 continuation: controlled HTTPS certificate replacement

Started implementing protected certificate-pair replacement for an existing
dedicated Windows deployment, with staging/trust validation, shared installation
maintenance locking, retained original files and explicit recovery. The API's
fixed TLS paths and certificate issuer remain unchanged. No live certificates,
keys, trust stores, services, firewall/task settings, customer database or Git
staging are modified. Native deployment/power-loss acceptance remains postponed.

Implemented an operator-only replacement/inspect/recover CLI with strict protected
configuration and runtime/environment/script binding. It stages both private
pairs, validates real TLS trust/hostname on an isolated listener, and shares the
installation update lock. In-place writes preserve the existing service-read
file identity/ACL while service restart/jobs/ingress remain disabled. Private
restart, native process/listener/readiness checks and exact live leaf fingerprint
verification precede admission. No CA trust, issuer, environment, app version or
database selection is changed. Explicit recovery binds fresh inspected hashes,
owner/installation evidence and retained snapshots; success archives the exact
lock/receipts. Stale inspection fails before claiming; unknown or failed claimed
recovery remains stopped for inspection. Application recovery rejects the distinct
certificate journal header rather than guessing how to handle TLS files.

All 248 unit tests (35 files) passed, including six real loopback certificate
lifecycle cases, private NTFS/in-place identity, partial-pair repair, controlled
expiry rejection, wrong trust/hostname, maintenance exclusion and harmless native
transport/binding tests. Existing TLS checks/monitoring and issuer tests remain
green. The first compile identified the HTTPS socket's base type and an optional
journal reference; corrected explicit TLS/phase typing. Lint caught a type-only
import and was corrected. Safe mocked native tests and all 18 PowerShell parser
checks passed before final review; build/smoke, shared database regressions and
final native/static verification are in progress. No real SCM/firewall/task or
client trust-store action has been performed.

Final verification passed all workspace/test TypeScript, lint, repository
formatting and Git whitespace checks; production package/API/web builds and the
compiled frontend/assets/API/real-database/OpenAPI/Origin smoke passed. Both shared
database update/recovery integration files passed (9 tests). Safe mocked Windows
update/certificate and deployment tests, in-memory backup-task checks and parsing
of all 18 PowerShell files passed after the final adapter changes. The TLS audit
now permits read-only preflight before its operation directory exists; every
mutating native action still requires the protected journal. No unrelated full
database suite or browser UI suite was rerun because no schema/UI changed.

This completes locally verified controlled replacement/inspection/recovery for
the existing dedicated-service boundary. It does not complete Phase 6, install a
service on this laptop, acquire/automatically renew issuer certificates, deploy
client/CA trust or certify Windows crash/reboot behavior. Original/replacement
private pairs are retained only in protected test/operation storage, never logged.
All fixture keys are ephemeral. No production key/certificate, runtime environment,
customer data, machine deployment setting or Git staging changed.

## Phase 6 continuation: publisher issuance register

Started the next independent commercial-operations item in the connected plan:
an explicit protected publisher register for license issuance/renewal, preventing
stale predecessor and duplicate first-issuance mistakes. Native installer/artifact,
provider, signing-key custody and professional approval gates remain pending.
No production keys/licenses, customer database, deployment configuration or Git
staging are changed. Implementation and verification are in progress.

Implemented explicit new-register initialization with a stable expected UUID,
read-only audits of existing private directories, full signed history verification
and authoritative predecessor checks. Per-sequence file-content flush and atomic
no-overwrite hard-link commit prevent two concurrent issuances from publishing
the same next sequence. Register commit precedes delivery output; exact export
recovers delivery failure without private-key access or another issuance. Normal
issuer CLI calls now require --register and --register-id. Output paths inside
the store are refused; malformed/gapped history fails closed. No bootstrap of
existing commercial history, cloud issuer, replication or instant offline
revocation is claimed. Windows directory metadata/power-loss acceptance remains
unverified despite local NTFS tests.

The first focused run passed all 11 issuer/register tests, including actual CLI
init/issue/export, concurrency, stale/duplicate/gapped sequences, key rotation,
host replacement and output recovery. Lint caught a fixture cleanup guard throwing
directly in finally; moved the guard into a guarded cleanup helper, then lint and
test TypeScript passed. Added final output-path/pending-file safeguards and POSIX
parent-directory flushes; full regression checks are in progress.

Full local regression passed all 240 unit tests (34 files), workspace/test
TypeScript, lint, production package/API/web builds, repository formatting and
Git whitespace checks. Compiled frontend/assets/API/real-database/OpenAPI/Origin
smoke passed. Both existing isolated entitlement integration cases passed,
confirming consumer installation/lifecycle compatibility. The focused issuer/
register suite passed again (11 tests) after the parent-directory audit and again
after final CLI environment/path handling. No schema,
API route, UI, customer license policy or dependencies changed, so unrelated
database/browser/native deployment suites were not repeated in this batch.

This completes the locally verified publisher-register batch. Phase 6 remains
incomplete: deployed authority/custody and restore reconciliation, approved native
installer artifacts, actual Windows/power-loss acceptance, provider/certificate
operations and professional tax review are still release requirements. No Git
staging or privileged laptop deployment was performed.

## Phase 6 continuation: forward-copy updates and paired schema recovery

Continuing the connected execution plan with schema-changing update/recovery
support. Initial native installation remains dependent on approved distribution
artifacts and postponed Windows acceptance. This batch will migrate only generated
copies, bind the original schema to cutover evidence and restore matching original
metadata on explicit recovery. No live database migration, laptop deployment,
dependency upgrade or Git staging is authorized or performed. Implementation and
verification are in progress; no new acceptance claim is made yet.

Implemented matching-target migration admission, explicit forward migration of
the generated copy, original/target schema cutover evidence and schema-aware
original-state restoration. The database switch records and verifies the original
schema with both OIDs. Reviewed Phase 5/6 retained-runtime probes share the existing
structural checks; normal current API startup retains every original probe.
Unknown retained schemas remain blocked, and all-organization maintenance is
unchanged. A pre-licensing database cannot pass commercial update eligibility.

All 235 unit tests (33 files) passed, including different-schema orchestration,
migration-failure exclusion, wrong target bundle, recovery metadata and legacy
journal coverage. Focused real database adapter checks passed after rebuilding.
The new actual PostgreSQL forward/rollback drill passed and rejected altered old
migration history; it deliberately uses a Phase 5 fixture and does not claim a
licensed upgrade. Initial combined runs had intermittent adapter/CLI failures.
The historical-schema scenario now runs last and retains its actual old schema
for fixture deletion, rather than re-migrating/re-granting it for later tests.
One overlapping diagnostic run also invalidated an existing cluster-wide catalog
count assertion; subsequent full database runs were strictly serial. A failed
candidate cleanup left one generated test database/role, removed only after exact
name/owner and zero-connection verification. No runtime role privilege was widened
and no connection guard was relaxed to obtain a passing result.

The complete serial integration run passed all 64 tests (12 files), including
forward/rollback, retained-history tampering, runtime privileges and compiled CLI.
Temporary sanitized failure diagnostics helped investigate the intermittent runs
and are removed from product code. Initial compilation hit sandbox process-spawn
EPERM and passed with approved worker access. Workspace/test TypeScript and lint
passed; final production build, smoke and diagnostics-free focused regression
checks are in progress. A test-file formatting failure was corrected.

Final verification passed production package/API/web builds and the compiled
frontend/assets/API/real-database/OpenAPI/Origin smoke check. After removing all
temporary diagnostics, both real update/recovery integration files passed again
(9 tests); both orchestration/recovery unit files also passed again (10 tests).
Final lint, repository Prettier and Git whitespace checks passed. No temporary
diagnostic symbols remain. No browser UI or native PowerShell behavior changed,
so browser and mocked native suites were not repeated. Actual Windows installation,
service/file cutover, LAN and reboot acceptance remain postponed and unverified.

This completes the locally verified supported forward-copy/recovery batch, not
Phase 6 or a production installer. The initial installer/uninstall, approved
artifacts, signing/issuer custody, provider operations and professional tax review
remain release work. No customer database schema, environment settings, dependency
versions, UI, services, tasks, firewall, trust store or Git staging were changed.

## Phase 6 continuation: connected completion workflow and failed-update recovery

Recorded one connected execution plan in phase-6-execution.md, following the user's
request to reduce fragmented planning and continue through meaningful batches.
Started failed-update recovery against the existing protected journals, retained
database OIDs and native service selection. Native acceptance remains postponed;
no services, tasks, firewall rules, trust stores, production databases or Git
staging are changed by this work. Implementation and checks are in progress.

Implemented shared, exclusive initialization and compare-before-replace installed
state; update admission records and commits the selected version/root before
admitting users. Explicit recovery checks operation/installation identity,
bounded protected evidence, original signed files, actual database name/OID pairs
and required operator acknowledgements. Unknown states and lost rollback replies
never authorize a guessed swap or automatic retry. Successful recovery restores
matching database/application/state, verifies readiness and atomically archives
the whole exact operation lock with its receipts instead of deleting evidence.
Recovery does not require active maintenance to restore an installed release.

Focused tests passed: five recovery safety cases, protected-state tests, existing
staging/journal/transport cases and three real database adapter integration cases.
The integration now injects an admission failure after metadata commit, then
performs a real rollback and restores the previous metadata. Windows service
effects remain mocked. Added native original-service restore/start/readiness/
admission operations and safe mocked lifecycle checks. A read-only storage audit
now rejects inherit-only unsafe ACEs on the managed directory itself, protecting
new metadata children; real temporary NTFS regression confirms rejection without
silently repairing permissions. Its first fixture modifier required unavailable
SeSecurityPrivilege; changed only fixture construction to DACL-only icacls, which
passed without audit-policy privilege or system ACL changes. Lint caught test-only
type-import style and was corrected. Full regression checks are in progress.

Investigated the next initial-installer dependency using official vendor sources;
see windows-artifact-review.md. No approved wrapper is present, and cached PG
binaries are not proof of distribution/checksum approval. No binaries were
downloaded or executed, and no vendor/package/runtime versions were changed.

Final local verification passed all 230 unit tests (32 files), all 63 isolated
database integration tests (12 files), workspace/test TypeScript, production
builds, lint and compiled frontend/assets/API/database/OpenAPI/Origin smoke.
The three harmless transport tests passed again after native original-service
actions/DACL-only grant changes. All 18 PowerShell files parsed; mocked service/
recovery and deployment checks and in-memory backup-task tests passed. Final
repository formatting and whitespace checks passed. No browser UI changed,
so browser workflows were not repeated. Remote CI and native Windows service/
file cutover, installation, LAN and reboot acceptance remain unverified.

This completes the locally verified recovery/state batch in the connected plan,
not Phase 6 or a production installer. Initial native provisioning/uninstall and
schema-changing updates still need the reviewed artifact/service lifecycle and
postponed test environment; SaaS provider, issuer custody, signing and professional
tax approval remain separate release dependencies. No current customer database,
laptop service/task/firewall/trust/startup setting or Git staging was changed.

## Phase 6 continuation: database and Windows service adapter binding

Started binding the sequencer to actual backup creation/restore verification,
quarantined candidate/runtime provisioning, maintenance checks and transactional
database switching. This adapter initially accepts schema-preserving releases
only; schema-changing packages must fail before stopping writers. It preserves
the original database/application paths and writes private cutover intent with
database OIDs before activation. Candidate maintenance inspection temporarily
withholds runtime CONNECT, opens only the operator connection and reseals before
restoring that grant. Windows service/file operations and verification are in
progress. No live service/database/configuration or Git staging changed.

Bound real database adapter integration passed both cases: encrypted backup and
restore drill, quarantined clone, signed maintenance checks, dedicated runtime
privilege provisioning, transactional activation, retained original OID/database,
real runtime authentication/readiness and pre-stop rejection of schema-changing
packages. Only Windows service calls were mocked in this integration fixture.
Moved the fixture into the database workspace after its first run exposed that
the API correctly has no direct pg dependency; no dependency was added. Corrected
one test-only helper path before all three native transport/schema tests passed.

Implemented the Windows backend for existing dedicated GSTBillingApi services:
identity/binary/config/ACL checks, maintenance ingress block, backup task disable,
disabled/stopped service, retained service XML, candidate selection and read access,
manual/private startup, HTTPS/listener checks and restoration of prior admission
state. Scripts execute from verified bytes via stdin, with no operator environment
secrets inherited. Safe mocked PowerShell lifecycle/XML tests pass; they caught
and corrected PowerShell XML attribute/property shadowing in the strict parser.
All 18 PowerShell files parse. A harmless wrapper transport test executes real
verified helper definitions, never native machine operations.

Full regression passed all 222 unit tests (30 files) and all 62 isolated database
integration tests (12 files), workspace/test TypeScript and production builds.
Full typecheck initially hit sandbox child-process EPERM and passed when rerun
with approved process access. Lint caught a regex spacing style issue and a test
cleanup guard throwing directly inside finally; corrected both without changing
product behavior. Final lint, API rebuild and compiled frontend/assets/API/
database/OpenAPI/Origin smoke passed. Repository formatting and whitespace checks
passed again after the final native path-separation guard, along with test types,
API rebuild, lint and all three focused native transport tests. The guard rejects
in-place/nested release updates and journals inside signed application trees.
The native transport tests and mocked Windows service/
deployment tests also passed after strict response typing and pure XML-selection
coverage were added. Existing safe in-memory backup-task tests passed without
registration. No browser UI was changed, so browser workflows were not repeated.

No native service/firewall/task/registry/trust/startup operation was run. Test
resources were confined to generated fixture files and isolated databases/roles,
which were cleaned up. Initial installation, protected installed-state management,
schema-changing update orchestration, guided rollback/uninstall, remote CI,
commercial signing/redistribution and native host/LAN/reboot acceptance remain
unfinished or unverified. This batch provides actual bound operations as a host
library, not a production-accepted installer command; the Windows postponement
remains in effect and no Git staging was changed.

## Phase 6 continuation: assisted-update safety sequencing

Started the application-update coordination core after reviewing the existing
signed package, backup, candidate migration, runtime access and database switch
implementations. No native installer entrypoint or default/no-op Windows adapter
is provided. Concrete signed package verification runs before stopping writers
and again after candidate preparation. The host contract requires an exclusive
maintenance lock, durably flushed phase records, stopped ingress/writers/restarts,
a fresh verified backup, quarantined forward-migrated candidate, current maintenance
for all original/candidate organizations, controlled activation and private
readiness before admitting users. Failures after a stop attempt keep the service
stopped and preserve recovery copies; ambiguous COMMIT errors never imply rollback
or trigger automatic schema downgrade. No service, task, firewall, trust store,
production database/configuration or Git staging was changed.

First focused sequencing run passed all 18 cases. Added a concrete file-backed
exclusive journal with serialized fsync'd records, strict sanitized fields,
owner-token checks and retained locks after interruption/failure. Reused existing
release-staging protection rather than weakening ACLs or adding dependencies.
The first three journal tests failed the real ancestor ACL audit under sandbox
TEMP; moved generated fixtures to the existing staging tests' private Windows
profile base without changing production checks. All three journal tests then
passed. Added an end-to-end simulated activation failure with a real journal and
retry-blocking lock. A full run passed 217 tests but one native ACL fixture hit
the default five-second test timeout; used the existing release-staging tests'
30-second budget for the new native journal fixtures, without loosening production
checks. The next full run passed 218 tests; added a final owner-token tampering
case and reran all unit tests successfully: 219 passed across 29 files.

API production build, test/application TypeScript and lint passed. Final repository
formatting and Git whitespace checks also passed. There are no new
dependencies, package scripts, schema migrations, product UI or executable
installer entrypoints. Actual service/database actions in the coordination tests
are simulated; signature verification, signed maintenance expiry checks and
temporary journal/lock/NTFS protection are exercised for real. Isolated database,
browser and Windows service/LAN/reboot suites were not repeated because no bound
database/UI/native service implementation changed.

This is an implementation checkpoint, not completion of the requested Windows
installer. The remaining native service/database adapter must bind the existing
operator tools, persist actual recovery paths/OIDs and implement initial install,
activation/rollback/uninstall against approved deployment binaries and a dedicated
service identity. No default adapter is supplied that could silently claim those
operations succeeded. Disposable host/client acceptance and signing/redistribution
remain external gates; the user's Windows postponement stays in force. See
assisted-updates.md for exact contracts and unverified boundaries.

## Phase 6 continuation: offline update maintenance eligibility

User confirmed active maintenance at installation time and eligibility for every
organization on a shared offline host. Implemented a reusable signed-grant policy
and a host-only read-only database preflight, with no development bypass or
tenant/status filter. Rejects missing grants, wrong binding, sequence mismatch,
clock rollback, inactive entitlement and absent/expired maintenance. Uses a
repeatable-read database snapshot and disables row-security filtering rather than
silently checking a tenant subset. Does not update clock markers or grants.
No installer exists yet: preflight success is not durable installation authority;
the future updater must recheck under its controlled maintenance/write stop.
First sandboxed
Vitest invocation hit child-process EPERM before tests; rerunning with approved
test-process access. No dependencies, schemas, production configuration, services
or Git staging are changed.

Verification passed all 196 unit tests (27 files), the new isolated PostgreSQL
integration test, API production build, application/test TypeScript and lint.
The database test initially violated the existing active-owner constraint;
corrected the fixture to create an owner in the organization transaction, then
reran successfully. It verifies all three organization statuses, missing-grant
rejection and unchanged stored grants/clock markers. CLI unexpected-argument
rejection returned sanitized output and exit 1 before database access. Formatting
found one import-layout issue; final repository formatting and whitespace checks
passed after correction. Existing unrelated
integration/browser/Windows workflows were not rerun for this isolated host-only
addition. Actual installation, service control and Windows acceptance remain
unfinished or postponed; no package installation is authorized by this check.

## Phase 6 continuation: remaining release requirements review

Reviewed the Phase 6 acceptance list against PROJECT_CONTEXT.md, recorded user
decisions, licensing operations and signed-release boundaries. Added
phase-6-release-gaps.md with unfinished implementation, external prerequisites
and required completion evidence. Distinguished postponed Windows acceptance
from unfinished installer/update orchestration; neither is complete. Identified
maintenance update eligibility as the next locally testable implementation,
pending release-date and multi-organization policy clarification. No commercial
policy, provider, signing key or tax approval was invented. This batch changes
documentation only; application tests are not repeated. Prettier formatted the
three affected documents successfully and git diff --check passed. No application,
configuration, database or Git staging changes were made.

## Phase 6 continuation: HTTPS certificate validity and expiry

Reviewed remaining Phase 6 gates after the Windows postponement and dependency/
HTTP-cache checkpoint. The existing API reads TLS files without checking hostname
or certificate dates before startup; the Windows runbook explicitly leaves expiry
monitoring unfinished. Implemented direct-HTTPS startup validation and warnings
for the certificates actually loaded by the running API. No new operator tool,
production key, trust-store change or Windows deployment test is introduced.
Verification used ephemeral test certificates and isolated loopback TLS.

Focused verification passed 25 API/TLS tests before the final partial-wildcard
case was added. This includes real HTTPS with per-request test trust, wrong-host
client rejection, earliest chain expiry, malformed/key/CA/usage/date/SAN failures,
warning boundaries/daily deduplication, sanitized log fields and timer shutdown.
No machine trust was modified. Strict test TypeScript caught one optional-property
type mismatch in the fixture response shape; corrected it before the passing run.
Full regression verification is in progress.

The first full run passed 184 unit tests, 59 integration tests, all type/build/
lint/format checks and compiled smoke. A follow-up regression then reproduced
acceptance of a configured TLS private key beneath WEB_ROOT. Added fail-closed
configured/physical path checks for that unsafe overlap and a separate-directory
positive case. No private key was served or real configuration changed. Final
verification of this additional guard is in progress.

Final verification passed all 186 unit tests and all 59 isolated integration
tests, production builds, workspace/test TypeScript, lint, formatting and compiled
frontend/assets/API/database/OpenAPI/Origin smoke. Private key bytes are read only
after public certificate validation succeeds; no production key or trust store
was used. Temporary fixture files/keys were cleaned up. A TLS test prerequisite
is documented for existing installed OpenSSL; the API runtime uses Node built-ins
and no dependency/package-manager/runtime versions were changed.

No UI changed, so browser workflows were not repeated. No live database, user
configuration, Windows service, certificate trust, signing key or Git staging was
changed. Automatic renewal, client trust/CA replacement, real Windows/LAN/reboot,
remote CI and commercial deployment remain unverified or unfinished. The Windows
postponement and existing tax/issuer/hosting gates remain in effect.

## Phase 6 continuation: postponed Windows matrix and release/security review

Recorded the user's explicit decision to postpone native Windows deployment tests
on their 8 GB Windows 11 Home Single Language laptop. No VM, machine changes or
OS/hardware purchase are required. The actual installer/service/ACL/TLS/LAN/reboot
matrix remains unverified and is still a commercial release gate. The next
independent planned item is production dependency/API release-security review;
findings and verification will be recorded as work proceeds.

Production dependency audit completed successfully: pnpm audit --prod --json
reported zero advisories across 149 production dependencies. This is registry
coverage at the time of the check, not proof of absence of vulnerabilities.
Added the same production audit to CI without dependency changes or exceptions.
API review reproduced mixed-case routes returning HTTP 200 without Cache-Control
no-store: Express matched these routes but the cache middleware used a
case-sensitive prefix. Corrected the prefix boundary and added unit cases for
case variants/API errors plus authenticated-session/401 integration assertions.
The first new test invocation omitted its fixture setup; corrected that harness
before reproducing the actual two mixed-case header failures. Focused API tests
passed all nine cases after the fix. Full verification passed all 167 unit tests,
workspace/test TypeScript, production builds, lint and formatting. Final verification
also passed all 59 isolated integration tests and the compiled frontend/assets,
API/database readiness, OpenAPI and Origin-rejection smoke check. The extended
real-HTTP security case verifies no-store on authenticated mixed-case session
responses containing CSRF data and on unauthenticated 401 responses.

This was a focused production-dependency/HTTP-boundary checkpoint, not exhaustive
commercial security certification. No dependency versions, database schema/data,
credentials, service configuration, Windows trust or Git staging were changed.
No UI changed; browser workflows were not repeated. Remote CI, actual Windows
deployment, signing/issuer custody, SaaS provider operations and professional tax
approval remain pending. Windows acceptance is explicitly postponed, not waived.

## Phase 6 continuation: Windows deployment observations

The interrupted previous turn made no filesystem changes; the checkout was clean.
Reviewed the existing manual PoC service/PostgreSQL/TLS/firewall scripts and their
unverified VM matrix. Added a read-only host/client observation command and safe
tests for its acceptance/failure decisions. It checks private IPv4 DNS/topology,
approved executable hashes, PoC service/XML identity, service-owned API listeners,
loopback database listening, HTTPS health/readiness/frontend contracts and client
database-port inaccessibility. Client mode rejects same-machine observations.
Public/mixed/unresolved targets are not contacted; redirected/unhealthy/wrong-type
responses and unsafe XML fail closed. HTTPS uses platform certificate validation,
no proxy/redirects, bounded response size and request/read/body-time budgets.

All 15 PowerShell files parsed successfully. Decision/contract tests passed with
mocked DNS/HTTPS/service/process/hash/network observations and real secure XML
parsing, including DTD rejection. A separate real CLI invocation rejected a
credential-bearing origin before networking, returned exit 1 and sanitized JSON.
The existing native Task Scheduler in-memory definition checks, full repository
lint/formatting and Git whitespace checks passed. Added the safe deployment tests
to Windows CI; remote CI was not run here. No application code changed, so the
previous 162-unit/59-integration/build/smoke checkpoint was not repeated.

No service, task, trust, firewall, ACL, database, credentials or laptop startup
settings were changed. No UI changed or staging was modified. The operator guide
lists host/client commands and manual acceptance scenarios. Actual native service,
certificate trust/TLS, browser LAN access, automatic PostgreSQL/API startup,
reboot, effective deployment ACLs and signed installer acceptance remain
unverified/unfinished. A disposable VM, approved artifacts and second Windows
client are still unavailable; this prevents completing actual deployment tests.

## Phase 6 continuation: controlled recovery switch

Reviewed the existing recovery preparation/runtime-grant workflow and Phase 6
requirements. Implemented host-only activation and explicit rollback using
transactional database renames on the same local PostgreSQL instance. This keeps
application configuration unchanged and retains the previous database. Tests used
only disposable databases; no live switch, service installation or customer
configuration change was performed. The command
refuses connected clients and validates recovery identity/schema/runtime
permissions before activation. Focused verification passed two input-validation
unit tests and all five PostgreSQL switch integration tests, including real
post-switch API login, original/recovered OID/data preservation, explicit rollback,
operator locks, blocked clients and a late name collision that rolls back the
active database's connection flag. Compiled CLI activation/status/rollback and
sanitized output also passed. Full regression verification passed all 162 unit
tests and 59 integration tests, workspace/test TypeScript, production builds,
compiled frontend/API/database/OpenAPI/Origin smoke, full lint and formatting.
Both activation and rollback now probe target API-runtime readiness, including
a negative rollback case that keeps the recovered database active when the old
copy is unreadable. Final focused verification passed all five switch integration
tests using an ephemeral non-superuser database owner with CREATEDB and a separate
restricted API login. Final test TypeScript and focused lint also passed. No
product permissions were broadened, dependencies added or Git staging changed.

The operator guide documents writer/service maintenance, data-point review,
explicit rollback acknowledgement, retained databases, temporary probe windows
and catalog inspection after an uncertain COMMIT. Preparation audit events are
not presented as proof that activation committed. Native Windows PostgreSQL,
service/reboot/LAN, real power-loss recovery, customer cutover and remote CI remain
unverified. No UI/PowerShell scripts changed, so prior browser/task-definition
checks were not repeated. Phase 6 remains in progress pending deployment gates.

## Phase 6 continuation: recovery runtime permissions

Resumed the saved runtime-access command and tests after interruption. Existing
staged changes are preserved. The command targets only a confirmed, quarantined,
generated recovery database with matching installation/schema identity and no
sessions. It grants a reviewed API table/column policy to an existing dedicated
unprivileged login, rejects unsafe existing permissions and records a candidate
audit event. It does not create credentials, change active configuration or
perform service cutover. Added safe retry handling and checks for schema grant
options. Focused verification passed two unit tests and four PostgreSQL integration
tests, including real restricted-account login/writes and protected SQL denial.
Added explicit wrong-installation/open-candidate rejection checks to the same
suite for final verification. Docker was stopped and has been restarted for
isolated fixtures. All 160 unit tests, workspace type checks, production builds,
lint/formatting and both PowerShell checks passed. Final verification also passed
all 54 integration tests, including the additional identity/open-state cases,
and the compiled frontend/API/database/OpenAPI/Origin smoke check. Final test
TypeScript and focused lint passed after those test additions.

The initial sandbox Vitest launch failed with a subprocess EPERM restriction;
the approved normal-execution rerun passed without weakening application checks.
The operator guide documents dedicated role setup, explicit table/column grants,
safe retries and inspection after host/database outages. No UI changed, so browser
workflows were not repeated. Native Windows PostgreSQL/service/installer/reboot/
LAN, actual disaster cutover, hosting and remote CI remain unverified or unfinished.
No active business data, credentials, service configuration or Git staging were
rewritten. Test-only databases and roles are cleaned up by the integration suite.

## Batch 1 — audit and architecture (2026-10-27)

- Read PROJECT_CONTEXT.md and PHASE_1_CODEX_PROMPT.md completely; repository had
  license, placeholder README, empty .gitignore and untracked planning documents.
  Preserved original planning files. No existing application code or tests.
- Created architecture, requirements, decisions and development plan.
- Commands: git status --short; node/npm/pnpm versions; docker info; psql lookup;
  npm metadata queries. Node 22.13.0, npm 11.15.0, pnpm 9.15.4 present.
- Docker CLI 29.9.2 present but daemon pipe absent; PostgreSQL binaries not on PATH.
- Sandbox npm network initially refused proxy connection; approved escalation to
  registry succeeds. Official Node/Nest/Vite/PostgreSQL references consulted.
- Next: implement workspace/API/web/database, install dependencies and execute checks.
- Pending: actual DB runtime and privileged Windows service/LAN/trust verification.

## Batch 2 — foundation implementation

- Added pnpm workspace, strict TS/ESLint/Prettier/Vitest tooling, ESM Nest API,
  versioned liveness/readiness, OpenAPI JSON, safe errors/logs, exact Host/Origin
  checks, TLS boundary, bounded DB pool and React connectivity shell.
- Shared runtime contracts and unimplemented billing-engine version boundary.
- Added Drizzle organizations schema, explicit serialized migration runner,
  isolated random-database integration tests and loopback-only Docker Compose.
- Added API/config and frontend request tests. Verification pending dependency install;
  implementation is not yet claimed to pass.
- Next: install/pin dependency lockfile, generate and review first migration,
  run checks, add CI/README and execute runtime smoke tests.

## Batch 3 — Windows spike and CI

- Added seven PowerShell PoC scripts and Windows runbook for isolated PostgreSQL,
  checksum-verified WinSW, restricted service identity, private CA/leaf generation,
  explicit trust and private-subnet firewall. Teardown preserves data.
- `powershell -NoProfile -File apps/windows-installer/scripts/Test-SpikeScripts.ps1`:
  seven scripts parse. Checksum helper accepts matching/rejects mismatching hash.
- ACL runtime probe blocked by sandbox Set-Acl UnauthorizedAccessException; no
  privileged installation attempted. PostgreSQL/service/LAN/HTTPS trust/reboot
  remain UNVERIFIED. See windows-offline-spike.md for the VM acceptance matrix.
- Added Linux build/test/database CI and Windows script-syntax job. CI itself has
  not been run remotely. Next: resolve install, migration generation and checks.

## Batch 4 — install and first verification

- Installed workspace using pnpm 10.34.9 and generated reproducible resolution lockfile.
  Replaced unsupported ESLint 9 with compatible ESLint 10; TS6 explicitly pinned
  because current Nest and typescript-eslint support it (not TS7).
- Generated and reviewed organizations migration and Drizzle journal/snapshot.
  `db:generate` initially hit sandbox spawn EPERM; approved compiler execution works.
- Fixed Windows cmd quoting in workspace scripts after an initial command silently
  matched no package globs. Explicit package-name filters now compile all packages.
- Initial build caught missing CSS import declaration; added Vite client types.
- Downloaded temporary ignored PostgreSQL 18.4 binaries for local tests, not product
  dependencies/artifacts. initdb completed (exit 0); actual startup/tests pending.
  Target packaged/development version remains patched PostgreSQL 18.6.
- Added secure random local .env setup and README/CI commands. Remaining: complete
  lint/typecheck/unit/build, DB integration and actual HTTP/proxy smoke verification.

## Batch 5 — real database and failure fixes

- Isolated PostgreSQL 18.4 started on 127.0.0.1:55432 after sandbox restricted-token
  startup failed; no system service/existing cluster changed.
- `pnpm test:integration`: PASS, 1 file / 3 tests; fresh randomized database,
  migration applied twice, insert, invalid-state/blank-name constraints and rollback;
  test database dropped during cleanup.
- Strict typecheck and build of API/web/packages PASS after fixing CSS types and
  using Swagger's JSON-only setup API with Nest 12 type definitions.
- Initial unit suite: 15/16 passed; shutdown assertion caught the DB cleanup override
  not running. Replaced override with Nest onApplicationShutdown lifecycle provider;
  rerun pending. No claim of passing shutdown before this verification.
- Added compiled HTTP smoke command; final formatting/lint/frozen install and runtime
  checks remain pending. Remote CI, Docker target 18.6 and browser/LAN tests unverified.

## Batch 6 — successful application verification

- `pnpm typecheck`: PASS including strict checking of tests/configuration.
- `pnpm build`: PASS; all shared packages, Nest API, Vite client assets compiled.
- `pnpm test`: PASS, 3 files / 16 tests, including shutdown lifecycle fix.
- `pnpm lint`: PASS; `pnpm install --frozen-lockfile --offline`: PASS (lockfile
  unchanged; pnpm noted intentionally blocked optional Scarf telemetry install script).
- `ENV_FILE=<private test env> pnpm db:migrate`: PASS against isolated cluster;
  second `pnpm db:generate`: no schema changes.
- `node --env-file=.local/test-db.env scripts/smoke.mjs`: PASS compiled static
  assets, API health, real migrated DB readiness, OpenAPI, forbidden Origin.
- With BROWSER_PATH set to installed Edge, then Chrome: PASS twice; both actual
  headless browsers rendered API Connected and PostgreSQL Ready without disabling
  browser sandbox or certificate verification. This was loopback HTTP only.
- PowerShell parser rerun PASS (7 files). Get-NetTCPConnection read probe blocked
  by sandbox permissions; SQL/OS listener evidence and cleanup remain final checks.
- Preserved concurrent user additions ignoring the two root handoff documents.
- Next: final config regression test/build, format check, development proxy smoke,
  stop temporary database and record exact remaining deployment limitations.

## Batch 7 — cleanup checkpoint (2026-10-27)

- Final `pnpm typecheck`, `pnpm test` (17/17), `pnpm build` and
  `pnpm format:check`: PASS. `pnpm lint`: PASS after final source formatting.
- Development entry points verified with native TypeScript Nest startup and Vite
  same-origin proxy: `/api/v1/health/ready` returned ready through port 5173;
  frontend HTML served successfully. Temporary API/web processes stopped.
- Headless Chrome and Edge both rendered Connected/Ready using built frontend.
- OS listener check (approved read outside sandbox) showed only 127.0.0.1:55432;
  no development API/web listener remained after cleanup. `pg_ctl ... -m fast -w stop`:
  PASS. Temporary PostgreSQL data retained, server stopped, no Windows
  service installed. `node scripts/setup-env.mjs` rerun preserved existing .env.
- `git diff --check`: PASS (Git notes repository CRLF conversion policy).
- Final CI uses current official checkout/setup-node/pnpm action majors, restricted
  contents:read permissions, isolated service credentials and compiled HTTP smoke.
  Workflow has not executed remotely.

### Execution environment notes

Initial verification used system Node22 and temporary PostgreSQL18.4. Batch8 below
supersedes those environment limitations with Node24/PostgreSQL18.6 verification.
Temporary tool binaries are ignored and not distributed. Early checks used
`npm exec --offline --cache .cache/npm --package=pnpm@10.34.9 -- pnpm <command>`
because global pnpm is 9.15.4. Initial
registry installs used the same wrapper with `--offline=false` under approved
network escalation. Compiler/process checks required approved execution outside
the sandbox after spawn EPERM/restricted-token failures.

The Windows spike meets Phase 1's executable-PoC boundary. Installer-managed DB
service, actual WinSW identity/reboot lifecycle, private-CA trust, LAN/firewall
behavior, certificate renewal, signed installer and recovery remain UNVERIFIED
or later-phase release gates. No production/customer billing claim is made.

Next work: run CI on Node24/PostgreSQL18.6; execute the disposable Windows VM spike
matrix; then Phase 2 secure identities/sessions, tenant memberships/RBAC, delegated
privileges and concurrency-tested owner protection before business endpoints.

## Batch 8 — recommended runtime and documented database target

- Downloaded ignored Node 24.22.1 executable without changing system Node. PATH
  scoped to verification process selects Node 24.22.1 and pnpm 10.34.9.
- Node24: lint, strict typecheck, unit tests (17/17), integration tests (3/3 against
  native18.4), API/web build and format check PASS. Edge render smoke PASS; native
  PostgreSQL shutdown PASS. System Node/pnpm installations were preserved.
- Started existing Docker Desktop hidden; daemon became available. `docker compose
up -d --wait`: PASS, new development cluster healthy. PostgreSQL reports
  `18.6 (Debian 18.6-1.pgdg13+2)`; published address verified `127.0.0.1:5432`.
  This resolves the earlier Docker unavailability; no existing cluster changed.
- On Node24 + Docker18.6: `pnpm db:migrate` PASS; `pnpm test:integration` PASS
  (3/3); `BROWSER_PATH=<Chrome> pnpm smoke` PASS including rendered Connected/Ready;
  `pnpm install --frozen-lockfile --offline` PASS, no lockfile changes.

## Phase 1 final acceptance

Implemented all Phase 1 application/tooling deliverables. Verified on Windows with
Node24.22.1, pnpm10.34.9 and PostgreSQL18.6: install, lint, strict types, 17 unit
tests, 3 isolated DB tests, clean/repeated migration, no schema-generation drift,
build, HTTP smoke and rendered browser connectivity. Development TypeScript/Vite
proxy path also passed. Secure defaults include loopback-only PostgreSQL, exact
Host/Origin checks, TLS required for LAN, sanitized errors/logs and ignored secrets.

Current local state: Docker development PostgreSQL18.6 is healthy on
127.0.0.1:5432 with reviewed migration applied and data preserved in its named
volume. Root ignored .env is configured for it. API/web smoke processes and the
temporary native18.4 cluster are stopped. Use README startup commands; `pnpm
db:down` stops Docker development services without deleting data.

Unverified: remote GitHub CI execution; privileged Windows service/installer
lifecycle, LAN HTTPS/private-CA trust, firewall/client matrix and reboot/recovery.
The executable spike and explicit VM runbook satisfy Phase 1's prototype boundary;
they are not a production installer. Phase 2 priorities remain secure identities,
opaque sessions, tenant memberships/RBAC, delegated authority and protected-owner
invariants. No GST compliance or customer billing readiness is claimed.

## Batch 9 — crash recovery audit (2026-10-27)

- Resumed from the existing Phase 1 acceptance checkpoint; did not regenerate or
  replace application source, lockfile, migrations, environment or Windows scripts.
- `git diff --name-status` and `git ls-files --deleted`: empty. Existing Phase 1
  files are staged and match their working copies; staging is preserved.
- `git diff --cached --check`: PASS. Source/package files, generated migration
  metadata, dependencies, private .env and temporary Node24/pnpm10 tools survived.
- Saved an ignored staged patch and SHA-256 content baseline under .local before
  editing this progress log. Environment values were not printed.
- Docker daemon is stopped following the crash (missing Linux-engine pipe).
  Previous passing results remain historical evidence, not new verification.
- Next: restart existing Docker, check the retained database, perform a frozen
  install and rerun lint/types/tests/build/migration/browser smoke. Preserve all
  existing source changes, secrets, migration history and database volumes.

## Batch 10 — preserved development environment recovered

- Restarted existing Docker Desktop and ran `docker compose up -d --wait`: PASS.
  Existing container recovered healthy; existing volume and credentials retained.
- PostgreSQL reports 18.6 and retains one entry in drizzle.__drizzle_migrations.
  Published endpoint remains 127.0.0.1:5432, with no LAN database exposure.
- Node24.22.1/pnpm10.34.9 tools recovered; frozen offline install PASS and lint PASS.
  Strict types/unit/build checks are still running at this checkpoint.
- SHA-256 baseline comparison: only this recovery log changed. All application
  source, lockfile, migrations and .env remain byte-identical to recovery start.
- Next: complete running checks, rerun isolated DB tests/migration/actual browser
  smoke, check staging and record final recovery results. No Phase 2 work added.

## Batch 11 — post-crash foundation checks

- Using recovered Node24.22.1/pnpm10.34.9: frozen offline install, lint, strict
  typecheck, unit tests (17/17), API/web/package build and format check all PASS.
- PowerShell script parser: PASS for all seven files; no privileged host changes.
- `pnpm db:migrate`: PASS against retained PostgreSQL18.6 database; existing
  migration safely recognized. `pnpm exec vitest run --project integration`: PASS
  (3/3), using already-rebuilt packages. Random test database cleaned up normally.
- No source fixes or dependency/schema replacements were needed. Remaining final
  recovery checks: schema generation drift, rendered Chrome/Edge connectivity,
  development proxy and final file/staging preservation comparison.

## Batch 12 — crash recovery completed

- `pnpm db:generate`: PASS, no schema changes or new migration files.
- `BROWSER_PATH=<Edge> pnpm smoke` and `BROWSER_PATH=<Chrome> pnpm smoke`: PASS;
  both browsers rendered Connected/Ready against the recovered PostgreSQL18.6.
- Native TypeScript API/Vite development proxy smoke: PASS. No application source
  replacement or further Phase 1 implementation was necessary after recovery.
- Final SHA-256 comparisons: zero unexpected tracked source changes; .env is
  unchanged. Saved staged-patch comparison confirms the entire original staging
  area is unchanged. Only this progress log was updated in the working tree.
- Git working-tree and staged whitespace checks PASS. Docker database remains
  healthy on 127.0.0.1:5432, migration history retains one entry, and integration
  tests left zero gst_test_* databases. Existing development data was preserved.
- All Phase 1 local acceptance checks have now passed again after the laptop crash.
  Remote CI execution and privileged Windows service/LAN HTTPS/firewall/reboot
  validation remain UNVERIFIED as before; see windows-offline-spike.md.
- No Phase 2 features, resets, staging replacements, credential regeneration,
  volume deletion or changes to historical migration files were performed.

## Phase 2 / batch 1 — scope and threat boundary

- User authorized Phase 2 implementation. Re-read the full project context and
  current code/schema/configuration. Working tree clean; Phase 1 is committed.
- Defined acceptance and reversible choices in phase-2.md. Consulted official
  OWASP and dependency documentation for password/session/CSRF/TOTP behavior.
- Existing health API, migrations and Windows spike will be preserved; additive
  security modules/schema follow, with tenant/privilege/concurrency tests.
- Next: identity/authorization schema, reviewed migration and security primitives.
- Untested at this checkpoint: all new Phase 2 functionality.

## Phase 2 / batch 2 — schema, services and executable security tests

- Added identities, edition-separated memberships/sessions, tenant-scoped roles,
  permission/delegation grants, hashed sessions/recovery credentials, encrypted
  MFA secrets, persistent throttles and audit events. Existing migration0000 intact.
- Generated additive migrations0001/0002. Review caught Drizzle emitting composite
  FKs before their referenced unique constraints; reordered the new unapplied SQL.
  Added serialized owner/edition integrity and append-only audit triggers.
- Added session/CSRF/password/TOTP/recovery services and REST controllers. Global
  shared-user password resets are forbidden across tenant boundaries.
- Installed Argon2id/OTPAuth; first install needed a non-interactive dependency-link
  refresh. Fixed query typing; compiler caught inferred-export type annotations.
- Added isolated HTTP/DB security tests (tenant attacks, delegation, concurrency,
  session expiration/revocation, MFA replay/recovery and audit immutability) and
  cryptographic behavior tests. Not yet run at this checkpoint.
- Next: execute tests/migrations, fix failures, implement identity/admin UI and host
  provisioning/recovery runbook. Phase 2 is not yet complete.

## Phase 2 / batch 3 — first execution and browser-facing flows

- Strict TypeScript passed for security services/controllers. First isolated DB/HTTP
  run PASS (12 tests total), including tenant constraints, ownership concurrency,
  session revocation/expiry, TOTP replay, single-use recovery and audit protection.
- Added acceptance-based invitations for existing identities, MFA rotation/disable
  rules, mandatory SaaS gating and host recovery credentials persisted before commit.
- Added React login, forced password change, MFA enrollment/challenge, organization
  switching, member/role/delegation administration, audit and session management.
  Paginated role editing retains unseen assignments rather than silently removing them.
- Added Playwright end-to-end tests using disposable databases and actual browser
  accounts. Dependency install/types/browser execution pending at this checkpoint.
- Next: run expanded tests, UI/browser verification and migration upgrade; finish
  operator/setup documentation and resolve any failures. Phase 2 remains in progress.

## Phase 2 / batch 4 — completed scope and regression checkpoint

- Added consent persistence preventing invite→suspend→activate bypass, safe member
  removal, effective-permission views, bounded password work/throttle cleanup and
  employee-reset/shared-account protections.
- Consolidated only the new, untracked/unapplied migration drafts into reviewed
  0001_identity_authorization.sql with final snapshot. Saved drafts under ignored
  .local for recovery; Phase 1 SQL/snapshot are untouched. New migration still
  requires fresh/upgrade execution after consolidation.
- Split React identity/admin forms into focused member, role and account-security
  components. Added private host CLI provisioning/recovery test and operator guide.
- First full lint run caught cleanup throwing inside finally in the new CLI test;
  fixed it to preserve original failures. Expanded full check/browser run underway.
- CI now includes the actual browser workflows on disposable databases. Remote
  workflow execution remains unverified. Next: fix any runtime/browser failures,
  verify upgrade and finish final evidence. Phase 2 is not yet marked complete.

## Phase 2 / batch 5 — regression fixes and unit verification

- Lint and strict types PASS after fixing the CLI's exact-optional-field typing.
  OpenAPI bodies now derive from the shared runtime contracts; login is explicitly
  documented without a pre-existing authentication requirement.
- Unit tests PASS (20/20). Initial Argon2 assertion assumed PHC parameter order;
  corrected it to assert algorithm/version and exact costs independently of order.
- Added MFA mandatory-disable/recovery-code-rotation assertions and full host CLI
  tests; expanded isolated integration/browser run is now executing.
- React member/role/account-security components are separate, preserve paginated
  assignments and display effective permissions. Operator guide documents no default
  login, existing-user consent, protected recovery and limited runtime DB privileges.
- Next: complete runtime/browser run, fix failures, apply reviewed upgrade locally,
  verify migration drift and update final acceptance evidence.

## Phase 2 / batch 6 — resumed verification (2026-10-28)

- Resumed the existing uncommitted Phase 2 changes after the session limit. No
  reset, dependency/schema recreation or change to Phase 1 history.
- Previous run completed 20 unit tests and 18 DB/HTTP integration tests. Browser
  run failed waiting for the organization selector after login; second scenario
  did not run. Those browser flows were not claimed as passing.
- Corrected select labels to explicitly reference their controls rather than
  include option text in the label. Added an explicit browser login-response
  assertion so an authentication failure is distinguished from selector failure.
- Next: run browser workflows, resolve failures, verify the additive local upgrade,
  finish regression checks and record final Phase 2 status. No new feature scope.

## Phase 2 / batch 7 — resumed browser verification and upgrade preparation

- Rebuilt the existing implementation; both Chrome Playwright workflows now PASS
  (2/2): owner role/member administration, employee forced password change,
  suspension revocation, authenticator enrollment and recovery-code login.
- One intermediate run hit the test server's cold-start deadline. Added a bounded
  startup allowance and sanitized startup-event/status diagnostics; no raw server
  stderr or credential payloads are echoed. Browser authentication now has an
  explicit status assertion instead of timing out on a later control.
- Verified Phase 1 SQL/snapshot have no changes. Development DB still has one
  migration and zero organizations. Created/inspected a pg_dump custom archive in
  ignored .local/backups before applying the pending upgrade. This was archive
  inspection, not a restore rehearsal.
- Windows spike guide now points to Phase 2 runtime privileges instead of implying
  the original organization-only grants are sufficient for the current checkout.
- Next: apply/repeat the upgrade, verify drift/credentials, run final regression
  and Edge workflows, then update acceptance and remaining deployment limitations.

## Phase 2 / batch 8 — local upgrade and setup-command correction

- setup:env added only the missing MFA encryption key; hashed comparisons confirm
  existing DB credentials/settings were preserved. Applied the reviewed upgrade
  twice successfully; db:generate reports no schema changes. Frozen offline install
  PASS without lockfile changes. Final regression run continues.
- Reviewed the documented first-owner command and found its filtered package
  invocation changed working directory, breaking root-relative private file paths.
  Kept the root CLI entry in the root directory and extended the existing isolated
  CLI test to run that exact pnpm command with relative paths. This fixes the setup
  workflow; it introduces no new feature or credential defaults.
- Next: finish regression/Edge verification, confirm no temporary test DB/processes
  remain, and record final acceptance/operational limitations.

## Phase 2 / batch 9 — complete browser run and final consent-boundary fix

- Final regression run PASS: 20 unit tests, 18 isolated integration tests, Edge
  browser workflows (2/2) and compiled HTTP/browser health smoke. Chrome workflows
  also passed (2/2) in batch7. New root-relative host CLI regression passed.
- Format check caught the newly edited CLI test's formatting; corrected it and
  lint passed. No dependency or product feature scope added.
- Final review found pending invitations were included in password-reset authority:
  an invite could block the real tenant's reset, or authorize a reset of an orphan
  identity without consent. Restricted reset authority/shared-account checks to
  accepted memberships and extended the existing consent regression for both cases.
- Next: verify this focused security correction, rerun required checks, confirm
  preserved migration history and clean test-resource teardown, then final acceptance.

## Phase 2 / batch 10 — final local acceptance (2026-10-28)

- Consent/reset correction verified: 18/18 isolated integration tests PASS, including
  the actual root pnpm provisioning command with relative private input paths.
  New regressions prove unaccepted invitations neither grant password-reset
  authority over an orphan identity nor block the actual tenant's authorized reset.
- Lint/strict typecheck PASS; API rebuilt. Chrome workflows PASS (2/2) after that
  correction, with compiled HTTP/browser health smoke PASS. Edge workflows also
  PASS (2/2) in the final regression run. Unit suite PASS (20/20).
- Frozen offline install PASS, reviewed migration applied/repeated successfully,
  schema generation reports no drift. Formatting checks PASS after formatting
  the latest regression test. Root DB credentials preserved; missing MFA key added
  without replacing existing values.
- Development PostgreSQL18.6 remains healthy at 127.0.0.1:5432; migration count=2,
  organization/user counts=0, leftover gst_test_* databases=0. No temporary API/Vite
  listeners remain. Existing customer/development records were not replaced; no
  default owner account was created. First owner is an explicit operator setup.
- Original Phase 1 SQL/snapshot have no differences from HEAD. Retained the inspected
  pre-upgrade custom archive under ignored .local/backups (not a restore rehearsal).
  Existing Git staging was preserved; final fixes are in the working tree for review
  and must be staged before committing the completed changes.
- Final post-fix unit run PASS (20/20); formatting and working-tree/staged Git
  whitespace checks PASS. Repeating setup:env preserved the entire configured .env
  byte-for-byte, including the existing MFA key.

Phase 2 implementation/local acceptance is complete. Remaining release gates:
remote GitHub CI execution; real Windows service/ACL/LAN HTTPS/firewall/reboot tests;
reviewed SaaS all-factors-lost platform recovery. These are not claimed as verified.
No catalog, GST math, invoicing, licensing, payments or other later-phase features
were added. Next implementation phase is business/GST registration, customers and
catalog, after review/commit of this phase.

## Local owner setup assistance (2026-10-28)

- User requested completion of setup using their existing private provisioning file.
  Validated field/JSON correctness without printing credentials. Confirmed no
  matching account/organization existed, avoiding duplicate provisioning.
- Existing database healthy; environment preserved and migrations current. Created
  the requested owner via the documented root command. Recovery output is in an
  NTFS-restricted .local/identity directory; input file permissions restricted too.
- Existing frontend was running but its API proxy returned502 because backend was
  absent. Started only the backend development watcher; preserved the user's frontend.
- Actual browser login, owner organization, member/role screens and logout PASS.
  Verification session was signed out; app processes remain running for the user.
- Found Vite's workspace file serving allowed a HEAD request to the private setup
  file. Added .local to fs.deny while retaining the default secret/Git exclusions.
  Verified403 for setup/recovery files, .env and .git/config; browser login still PASS.
- No passwords, recovery credentials or session tokens printed to chat/logs. No
  existing credential file, recovery output or database volume was overwritten.

## UI redesign / batch 1 — review and layout direction (2026-10-28)

- User requested a substantial UI correction. Reviewed the existing React panels,
  session/authorization flows, CSS, browser tests and smoke checks before editing.
- Identified the main problems: narrow stacked layout, always-visible forms,
  technical permission labels, weak hierarchy and developer diagnostics in the
  main workflow.
- Implementing separate overview/member/role/security/activity views, responsive
  navigation, readable tables/cards and accessible dialogs. Scope is presentation
  and interaction; existing authentication/API/tenant rules remain authoritative.
- Next: implement the visual foundation and screens, update browser tests for
  explicit navigation/dialogs, then verify desktop/mobile appearance and workflows.

## UI redesign / batch 2 — implementation (2026-10-28)

- Replaced the long stacked page with a responsive sidebar workspace, separate
  overview, members, roles, activity, account-security and system-status views.
- Added a team table with page-local search, role cards, readable permission
  groups, focused native dialogs, keyboard dismissal/focus restoration, and a
  dedicated sign-in layout. No external fonts, assets or dependencies added.
- Preserved existing API contracts, tenant permissions, owner protections,
  password/MFA/recovery and session operations. Role sharing remains a subset
  of selected permissions; server authorization remains authoritative.
- Frontend TypeScript check passed. Browser workflows updated for navigation,
  dialogs and responsive overflow checks; build/lint/browser verification underway.
- Existing staged changes and local credentials were preserved.

## UI redesign / batch 3 — regression fixes and verification (2026-10-28)

- Production build, lint, 20 unit tests and full workspace/test TypeScript checks
  passed. Desktop overview/role/member screenshots inspected using test-only data.
- Browser checks found that reselecting the already-selected organization could
  clear its context without fetching again. Added an equality guard and retained
  the regression scenario in the browser workflow.
- Mobile overflow/search-layout checks caught presentation issues. Replaced the
  phone member table with compact member cards and fixed search-field direction.
- Keyboard dialog opening, initial focus, Escape dismissal/focus return, role
  creation and member creation passed before the responsive assertion. Full
  workflows are being rerun after those fixes.
- API/static smoke checks passed. The optional Chrome command-line DOM smoke
  process exited with no output; this is not a passed browser smoke check.
- Edge's headless DOM smoke passed: built sign-in screen and healthy service
  status rendered against the migrated development database. No business rows
  were changed by that smoke check.
- Phone member cards, mobile navigation, overflow checks, forced password change,
  employee access restrictions and HttpOnly cookie checks passed in Chrome.
  Membership status labeling was made explicit before rerunning the complete flow.

## UI redesign / batch 4 — final local acceptance (2026-10-28)

- Both complete browser workflows passed in Chrome (2/2) and Edge (2/2), using
  disposable databases. Verified role/member creation, membership suspension,
  forced password change, employee authorization, HttpOnly cookies, authenticator
  enrollment, recovery-code display/use and MFA sign-in.
- Also verified desktop/390px phone overflow, mobile navigation, separate screens,
  and dialog initial focus/Escape/focus restoration. Inspected screenshots of
  desktop overview/roles/members and phone members; captures use fixture data only.
- Production build, full TypeScript, lint, formatting and 20 unit tests passed.
  Edge browser startup smoke passed, including live API/database connectivity.
  The earlier optional Chrome CLI DOM launch failure remains recorded above;
  Chrome Playwright workflows passed after the fixes.
- UI changes add no dependencies or backend/schema changes. Existing credentials,
  business data and staging were preserved. Automated checks provide local
  regression evidence, not a performance benchmark or an exhaustive audit.
- Phase 2 implementation/local acceptance remains complete with the redesigned
  UI. Native Windows service/LAN HTTPS/firewall/reboot and remote CI release gates
  described in phase-2.md remain outstanding; loopback browser tests do not prove them.

## Phase 3 / batch 1 — requirements and architecture review (2026-10-28)

- Read PROJECT_CONTEXT.md completely and reviewed current schema, identity/RBAC,
  controllers, API error handling, workspace UI, tests, migrations and CI.
- Working tree was clean after the Phase 2 commit. No credentials were read/output.
- Defined Phase 3 scope/acceptance in phase-3.md and checked official GST taxpayer,
  HSN and NIC state references. No statutory rates or invoice compliance invented.
- Next: shared contracts, tenant business schema and reviewed migration; then API,
  responsive screens and isolated integration/browser verification.

## Phase 3 / batch 2 — contracts, schema and API implementation

- Added shared strict validation for domestic addresses, structural GSTIN/state,
  customer/catalog inputs, decimal-string prices/rates, units and versioned writes.
- Added business profiles, one-active GST registration/history, customers, catalog,
  immutable dated tax revisions and review attestations with tenant-safe FKs.
- Generated/reviewed migration 0002_business_catalog; added new permission seeds,
  append-only tax guards and deferred requirement for a catalog tax revision.
  Earlier migrations remain unchanged; no existing non-owner privileges expanded.
- API reuses session/CSRF/MFA/current tenant authorization and organization locks,
  bounded searches/pages, optimistic versions, archives and transactional audit.
  Extended mandatory SaaS MFA to customer/catalog managers and tax reviewers.
- Package compilation passed; API declaration checking found a non-portable inferred
  database getter type and it was given an explicit shared Database type. Next:
  integration tests, responsive UI and full regression checks. No migration has
  been applied to the user's development database in this batch.

## Phase 3 / batch 3 — UI and first regression pass

- Added business/GST setup, customer and catalog screens in the existing sidebar.
  Includes server-side search, archive filters, pagination, versioned saves,
  archive/restore, tax-review reference/history and responsive dialogs/member cards.
- Registration confirmation is an explicit fresh attestation on each save; no
  automatic portal verification or e-invoice eligibility determination is claimed.
- API/customer/catalog/profile reads validate transport contracts. Catalog reads
  use repeatable-read transactions so prices and classification revisions agree.
- First complete integration rerun passed 23/23 and unit tests passed 24/24.
  Fixed empty-profile transport to return a JSON envelope, and corrected the
  Drizzle read-only transaction option after compiler feedback.
- Added further tests for 51-record pagination, finite DB prices, mandatory catalog
  classification, stale tax review and new SaaS manager/reviewer MFA requirements.
- Next: rerun expanded integration suite, build and browser workflows; inspect UI,
  then migrate the local development DB and document upgrade/deployment privileges.

## Phase 3 / batch 4 — integration/browser acceptance and local upgrade

- Expanded integration suite passed 25/25, covering tenant boundaries, customer
  concurrency, archive/restore, literal search, 51-row pagination, exact prices,
  stale reviews, immutable history, audit rollback, DB guards and SaaS manager MFA.
- Chrome passed all 3 browser workflows: existing identity/RBAC/MFA plus business
  persistence, customer archive/restore, catalog review/invalidation/history and
  390px mobile layout/dialog/navigation checks. Inspected desktop/mobile catalog
  screenshots; all captured data is disposable fixture data.
- Added OpenAPI request/response contracts and bounded directory query descriptions.
- Applied reviewed migration 0002 to the development DB and reran it. Readiness
  passed. Before/after in-process hashes confirmed existing organizations/users/
  memberships/roles/grants/MFA/owner-recovery records were unchanged; no credentials
  or hash values were printed. Existing .env and owner files were preserved.
- Improved sidebar spacing so Phase 3 navigation fits without hiding settings.
  Next: final Edge/Chrome smoke/regression, types/lint/format/drift checks and docs.

## Phase 3 / batch 5 — final checks and directory error handling

- Final full workflows passed 3/3 in Edge and 3/3 in Chrome. Edge headless startup
  smoke passed against the migrated development database; final unit suite 24/24.
- Full workspace/test TypeScript and lint passed. Formatting found one newly
  extended test file; formatted it and reran formatting successfully.
- Drizzle generation reported no schema changes; checked-in 0002 snapshot and
  reviewed SQL match the current declarative schema. Prior migration files unchanged.
- Final review tightened failed-directory reloads to clear stale rows and permit
  retry, and prevents Next from exceeding the documented 10000 offset bound.
  Added a browser failure/retry regression; rerunning only the affected business
  workflow in both browsers plus frontend build/lint/format.
- Development frontend was not listening when checked. Checking service ports
  before starting the updated workspace without replacing existing processes.

## Phase 3 / batch 6 — final local acceptance (2026-10-28)

- Complete: business/GST setup; customer/catalog CRUD with archive/restore; exact
  prices; one-active registration; versioned classification/review history; explicit
  permissions/MFA; optimistic concurrency; transactional audits; responsive UI.
- Final evidence: production build; full workspace and test TypeScript; lint;
  24/24 unit tests; 25/25 isolated DB/HTTP tests; 3/3 full workflows in Chrome and
  Edge. Latest directory failure/retry workflow passed again in both browsers.
  Final formatting and whitespace checks passed after this documentation update.
- Drizzle generation found no schema drift. Development migration applied twice;
  existing identity/organization/grant/MFA/recovery fingerprints remained unchanged.
- Edge compiled-app smoke passed. Existing API on port3000 was preserved. Started
  Vite on port5173 (PID19828), with timestamped ignored .local logs/PID file. HTTP
  checks verified live readiness, frontend proxy and unauthenticated rejection of
  the new business endpoint. Real Chrome verified localhost:5173 sign-in and healthy
  API/database status without accessing private owner input or creating a session.
- PowerShell's localhost probe did not connect; direct loopback HTTP checks and
  real Chrome at localhost passed. Browser behavior is verified independently of
  that PowerShell probe.
- No new dependencies, invoice calculations/issuance/printing, payment/inventory
  features or production GST compliance claims. Earlier migrations, .env, existing
  owner input/recovery files and user's Git staging were not overwritten.
- Still unverified: remote GitHub CI and native Windows service/ACL/LAN HTTPS/
  firewall/reboot deployment behavior. Phase 4 covers the legally reviewed GST engine.

## Phase 4 / batch 1 — scope and official-source review (2026-10-29)

- Working tree clean after Phase 3. Reviewed PROJECT_CONTEXT.md, architecture,
  Phase 3 contracts/classification history and the reserved billing-engine package.
- Checked official CGST valuation/discount/rounding, Rule 35, IGST place-of-supply,
  2024 B2C goods clarification and UT/Ladakh sources; references in phase-4.md.
- Recorded supported scenarios, exact rounding/discount/allocation policy and the
  distinction between source review and professional tax approval. No rate seeds,
  invoice issuance, API/UI endpoints or customer-data changes in this phase.
- Added shared calculation contracts and an internal workspace dependency so the
  pure engine can reuse validation/units/state/classification schemas.
- Next: exact arithmetic, guided jurisdiction, effective-date selection, calculation
  engine and comprehensive arithmetic/validation/property/regression tests.

## Phase 4 / batch 2 — engine implementation and first tests

- Added pure BigInt scaled arithmetic, half-up paise rounding, deterministic
  largest-remainder allocation, balanced rate-group component reconciliation,
  guided domestic POS/UTGST selection and reviewed effective-date selection.
- Implemented inclusive/exclusive prices, exact quantity/line discounts, eligible
  exclusive-value invoice discounts, bounds, safe errors, version metadata and
  explicit trusted override authority/provenance. Results never authorize issuance.
- Core shared packages compiled. Added synthetic golden fixtures, jurisdiction,
  malformed-input/authority/history/bounds tests and 300 seeded-cart reconciliation,
  immutability/permutation checks plus a maximum 1000-line cart. Tests underway.
- Test fixtures kept outside production source/output. No new external package,
  database migration, endpoint, UI or customer/credential edits.
- Next: fix test/type/lint feedback, independently cross-check arithmetic and
  execute the built package in actual browsers before application regressions.

## Phase 4 / batch 3 — arithmetic verification and reviewable example

- First unit run passed 101/102. The overflow fixture incorrectly used six decimal
  quantity places with KGS (three allowed); corrected it to OTH (six allowed),
  preserving the production precision guard. Full strict TypeScript and lint passed.
- Independently cross-checked 400 synthetic price/quantity/rate/discount cases using
  PowerShell System.Decimal (a separate decimal arithmetic implementation). All
  supply values, taxes, component totals, discounts and final totals matched.
- Added a runnable public synthetic example and package README documenting caller
  trust, dated complete histories, discount bases, exact money and issuance limits.
- Removed only stale generated fixture artifacts after moving helpers outside
  production src. Next: rerun unit suite, browser bundle parity, full app regressions.

## Phase 4 / batch 4 — resumed after usage-limit interruption

- Resumed from existing files and batch 3; no reset, replacement of prior work,
  credential access or staging changes. The earlier final-check command was not
  executed because automatic approval review could not complete at the usage limit.
- Source/example and earlier evidence retained: corrected suite 102/102, 400-case
  independent Decimal agreement, 403-case Node/browser parity in Chrome and Edge.
- Added tests already present at interruption: 600 allocation quota/capacity/
  permutation cases and special-service/e-commerce/unreviewed-baseline boundaries.
- Frozen offline installation passed without new external dependencies. Formatting
  applied to the last two new test files; final expanded unit/types/lint checks running.
- Next: application DB/browser/smoke regressions, example execution and final log.

## Phase 4 / batch 5 — resumed checks and development-service recovery

- Expanded unit suite passed 105/105. Full workspace/test TypeScript and lint passed.
- Formatting detected the newly appended progress log; it will be formatted after
  final evidence is recorded. No production-code formatting failure remains.
- Integration setup could not connect to 127.0.0.1:5432; all 25 tests were skipped,
  not passed. Docker Desktop's Linux engine was stopped (missing named pipe).
- Starting the existing engine/container without changing compose settings, .env,
  credentials, migrations or the persistent volume; then rerun the pending checks.

## Phase 4 / batch 6 — recovered service and regression results

- Docker Desktop engine started normally; the existing PostgreSQL18.6 container
  and volume were reused and became healthy on loopback port5432.
- Reran the previously skipped suites: all 25/25 isolated DB/HTTP integration tests
  passed. This supersedes the setup failure above; no tests were treated as passed
  while the database was unavailable.
- Runnable example passed: 250.00 supply value, 22.50 CGST + 22.50 SGST, 295.00 total;
  issuanceAllowed remained false. Production output contains only engine modules,
  declarations/maps; synthetic fixtures/tests remain outside dist.
- Confirmed no Phase 4 edits to API/web/database/migration/environment files and
  no Git staging changes. Final application build/browser/startup checks underway.

## Phase 4 / batch 7 — final engineering acceptance (2026-10-29)

- Resumed all pending work after the usage-limit interruption and preserved the
  implementation, test fixtures, existing files and Git staging. No code was reset.
- Passed: frozen offline installation; 105/105 unit tests; full workspace/test
  TypeScript; lint; production package/API/frontend build; 25/25 isolated DB/HTTP
  tests; all 3 application workflows in Chrome and all 3 in Edge; compiled startup
  smoke with healthy database/API, OpenAPI, assets and Origin rejection.
- Earlier engine-specific verification remains valid: 400 independent Decimal
  comparisons and 403 exact Node/bundled-browser parity cases in each browser.
  Tests include 300 seeded cart reconciliations/permutations, 600 allocation quota
  cases and a maximum 1000-line cart. No binary floating-point financial arithmetic.
- Runnable example verified 250.00 supply value, 45.00 GST, 295.00 total and the
  issuanceAllowed=false boundary. Production dist excludes tests/synthetic fixtures.
- Docker Desktop/PostgreSQL stopped during the interruption; the existing engine,
  container and persistent volume were started normally. Initial DB setup failures
  and skipped tests are documented above and were superseded by a full passing rerun.
- No new external packages, API/UI endpoints, business schema or migrations. Existing
  .env/owner files/credentials/customer data were not changed; Git staging unchanged.
- Final formatting and whitespace checks run after this log update. Phase 4 code
  and local engineering acceptance are complete; source review is not professional
  tax certification. Professional approval, invoice issuance/e-invoice controls and
  native Windows deployment/remote CI release gates remain explicitly unverified.

## Phase 5 � batch 1: scope and contracts (2026-10-29)

Read project context, current architecture, requirements, decisions and existing
business/identity/database/UI conventions. Phase 4 is committed; starting tree was
clean. Defined bounded invoice draft/finalize/reversal contracts and presentation
transport. Added granular invoice/override permission keys; existing grants will
not be expanded. Recorded source review, numbering, immutable snapshots, and the
non-bypassable pending professional issuance gate in phase-5.md. Verification:
repository inspection only so far; compilation/integration follow with persistence.

## Phase 5 � batch 2: persistence/API and billing workspace

Added reviewed generated invoice/series/financial/snapshot schema plus custom DB
immutability, rollback-safe counter and deferred reconciliation guards. Implemented
server-derived calculation, versioned/idempotent drafts, reviewed-preview digest,
atomic gated finalization and linked full-credit drafts. Added Invoices navigation,
customer/catalog search, quantities, line/invoice discounts, authorized price override,
server totals and escaped versioned A4 draft rendering with external print CSS.
Commercial gate remains enforced; existing roles receive no automatic new grants.
Compilation/tests are running; no claim of verified workflows yet. General partial
credits/debit/cancellation and configurable logo remain outside the implemented boundary.

## Phase 5 � batch 3: initial verification and corrections

Unit checks passed 110/110. First isolated integration run passed all seven invoice
cases and 24 existing cases; one host-CLI test rejected the invocation because direct
`pnpm exec vitest` lacks the documented package-script context (`npm_execpath`).
Rerun through `pnpm test:integration` is required; no production failure inferred.
Fixed compiler-discovered JSX closure and portable DB getter annotation; internal
renderer linkage was installed offline with no downloads. Existing development
PostgreSQL container was checked healthy. Added real-gate, tenant/CSRF, stale-version,
permission-revocation, rollback, immutable history and full-reversal integration tests.
Only test-local module spies exercise issuance machinery; production has no bypass.
Chrome/Edge browser invoice tests and final type/lint/build checks remain pending.

## Phase 5 � batch 4: regression findings and hardening

Documented integration command passed 32/32, including host CLI and all seven
initial invoice cases; production API/frontend build passed. First Chrome run passed
existing identity/business flows and exposed ambiguous wrapping labels on discount
selectors; fixed explicit accessible names before rerunning. Preserved custom
delivery addresses after save, exposed saved item names, added runtime response and
OpenAPI schemas, and replaced per-line catalog/history queries with bounded batch
reads. Added authorized tax/place override UI and provenance/baseline integration
coverage. Strengthened draft/finalized non-null constraints and deferred financial
reconciliation to compare individual lines/components with the snapshot. Added
missing-snapshot/corrupt-row rollback tests. Final reruns pending; no hardware
printer, LAN HTTPS/service install or professional compliance validation claimed.

## Phase 5 � batch 5: browser acceptance and safe local migration

TypeScript, lint, 110/110 unit tests and 34/34 integration tests passed; full production
API/web build passed. Drizzle generation reports no schema changes. After fixing
explicit labels for discount selectors and saved note/terms fields, all four browser
workflows passed in Windows Chrome and Edge. Invoice workflow verifies exact INR259.60
from quantities/line/invoice discounts, save/reopen, draft warning, escaped note text,
print action and mobile width. A synthetic 100-row A4 document produced a multi-page
browser-captured PDF in both browsers; repeated table-header CSS was checked. This
is browser rendering proof, not hardware/spooler or statutory document certification.

Before development migration, created ignored `.local/backups/gst-phase5-before-20261029.dump`
(62,444 bytes) and checked its pg_restore archive list. No restore claim. Applied
0003 explicitly through pnpm db:migrate; before/after aggregate organization/user/
membership/role/grant/assignment/customer/catalog/profile/registration/classification/
review/audit counts matched. New invoice tables remain empty, with no issued invoices.
Credentials, customer records and existing grants were not changed. HTTP/assets/real
readiness/OpenAPI/Origin smoke passed; final browser smoke result and final formatting/
whitespace/test-type checks follow. Git index remains untouched.

Full Phase 5 is not marked complete: real issuance remains blocked by professional
calculation/document/compliance approval and e-invoice eligibility. Partial/debit
corrections, cancellation policy and configurable logo remain unfinished. Implemented
full-credit machinery is exercised only with synthetic test release spies. No runtime,
HTTP, environment or UI bypass of the real issuance gate was introduced. Native
Windows deployment, hardware printers and remote CI remain separate unverified gates.

## Phase 5 � batch 6: final checkpoint

Final test TypeScript compilation, lint, whole-repository formatting and Git whitespace
checks passed. Compiled-app browser smoke also passed: sign-in rendered and live API/
PostgreSQL status was healthy. Final Chrome and Edge runs each passed all four workflows,
including multi-page A4 capture. No external dependency was added (lockfile changes
only link internal billing/renderer workspaces). Development migration is applied;
restart pnpm dev and open Invoices as owner. All source changes remain unstaged;
no commit, index reset, credentials rewrite or existing-data deletion was performed.
Phase 5 remains explicitly partial for the release/policy and logo gaps listed above.

## Phase 5 continuation ? batch 7: resumed unfinished scope

Preserved the user-staged Phase 5 work and resumed the in-progress contract/logo
changes without altering the index. Added a pure original-value correction policy:
partial credits consume remaining original/debit values and residual component paise;
debits retain original classification and balanced group rounding. Added correction
draft create/update, append-only cancellation records and idempotent server methods.
All issued operations still enforce the existing release gate. Added bounded PNG
logo validation/upload, snapshot data and safe renderer support. Generated additive
0004; the applied 0003 migration is unchanged. Integration, UI and regression checks
follow; no completion claims at this checkpoint.

## Phase 5 continuation ? batch 8: verification and edge-case fixes

Initial unit run passed 114/114, including 300 sequential partial credits conserving
component paise, debit balance expansion and bounded PNG validation. Fixed one lint
finding in the new arithmetic code. Compiler and lint then passed. Initial integration
run passed 37/38; the remaining logo test incorrectly read the GET response wrapper
as the profile input. Fixed the fixture to read body.profile (no weakened validation).
Added cancellation/credit race, editing/version, current-release gate and frozen-logo
integration coverage. UI now distinguishes value adjustments from physical quantities,
shows debit-note labels, supports editable corrections and safe discard/cancellation,
and tests browser PNG upload, preserved draft cancellation and correction dialogs.
Tests for issued-document browser controls use explicit read/submit fixtures; real
backend transactions are tested separately with test-local release spies.

## Phase 5 continuation ? batch 9: engineering verification and permissions

Fresh shared-package compilation, lint, 114 unit tests, 38 integration tests and the
production build passed. A previous build caught a stale generated permission type
while the new cancellation permission was being added; rebuilding shared packages
resolved it. Cancellation now uses its own grant and privileged SaaS MFA boundary;
existing role grants are not expanded. Added DB original/classification/cumulative
balance guards and rejected issued-note cancellation in favor of a counter-adjustment.
Correction snapshots retain original/prior-note digests for reconstructable balances.
Chrome verification of all five workflows (including logo/discard and correction
forms) is running; issued controls use explicit frontend fixtures, not real issuance.

## Phase 5 continuation - batch 10: final acceptance and preservation

Final unit run passed 115/115; integration passed 38/38. TypeScript, lint and full
API/frontend production build passed. Chrome and Edge each passed all five workflows,
including logo decode/print, draft discard/reopen, A4 pagination and versioned
correction dialogs. Actual credit/debit/finalization/cancellation transaction behavior,
residual balances, races, immutability and real gates are covered in isolated DB tests;
issued UI controls use explicit test fixtures and never bypass production policy.

Saved a new private custom-format backup in .local/backups (unique filename) before
0004, validated its archive list, then applied the reviewed migration explicitly.
Existing rows in business, financial, identity, credential, audit and grant tables
matched their before/after counts and fingerprints; intended new schema fields were
excluded from that comparison. No data/credentials/grants were rewritten. Applied
0003 remains unchanged. New invoices.cancel is defined without granting non-owners.
Compiled HTTP/assets/readiness/OpenAPI/Origin and Edge sign-in/health smoke passed.

The final formatting run found two updated TS files needing formatting; both were
formatted, and the final compiler, lint, repository formatting and Git whitespace
checks passed. The previously unfinished correction/cancellation/
logo engineering scope is complete within phase-5.md boundaries. Real issuance and
issued cancellation stay disabled pending professional approval. Hardware printers,
Windows service/ACL/LAN HTTPS/firewall/reboot, restore and remote CI remain unverified.
User-staged work is preserved; continuation changes remain unstaged and no commit was made.

## Local dependency repair: Windows Argon2 installation

The system Node 22.13.0 process exited with Windows access-violation code
-1073741819 when loading the installed Argon2 Windows prebuild. The same binary
loaded successfully under the existing local Node 24.22.1 runtime. Completed
`pnpm install --offline --frozen-lockfile` using local Node 24.22.1 and pnpm
10.34.9 (exit 0), then `pnpm rebuild argon2` (exit 0). An in-memory Argon2id
check passed native loading, hashing, correct-password verification and
wrong-password rejection. No credentials, database data, dependency versions,
lockfile or staging were changed. The system-default Node/pnpm were not upgraded;
future terminals must select the working toolchain. API connectivity remains a
separate follow-up and was not tested in this repair.

## Local API connectivity verification after runtime repair

Verified the already-running development services without restarting them:
direct API and proxied frontend liveness returned 200. The existing private
Chrome verification script passed proxied liveness (200), database readiness
(200), anonymous session rejection (401), and rendered sign-in/operational
indicators with no workspace connection error. No real account sign-in was
attempted. No application code, configuration, credentials or staging changed.
The earlier system-Node native-module crash explains why the API watcher could
remain running without an API listener; connectivity now passes after selecting
the working runtime. Automatic startup after terminal/Docker shutdown is not
provided by the development setup.

## Invoice validation: actionable customer registration mismatch

A read-only aggregate check found the sole active local customer has a GSTIN
state prefix different from its saved billing-address state. Invoice preparation
already rejects this inconsistent master data, but previously returned only
`INVALID_INPUT`. It now returns `CUSTOMER_REGISTRATION_MISMATCH` with guidance to
correct the customer GSTIN or saved billing address, explicitly distinguishing
the invoice delivery address. No local customer or invoice data was modified.

All 14 invoice integration tests passed in a disposable database, including a new
regression covering preview/save rejection, no persisted draft on rejection, and
successful draft creation after correcting synthetic customer data with a
different delivery state. The first test invocation lacked the explicit test
database URL and ran no tests; the documented migration connection was then
provided privately for the successful run. API type checking, targeted ESLint,
and Git whitespace checks passed. Existing staged changes were preserved.

## Invoice form: explain conflicting customer states before submission

Selecting a customer whose GSTIN prefix conflicts with its saved billing-address
state now shows an inline alert below Bill To naming both states and their codes.
The alert directs the user to correct the customer registration details in
Customers and reselect it, and explains that the invoice delivery address is
separate. Preview/save also stop locally with this explanation instead of sending
a known-invalid request. Existing server validation remains authoritative for
saved drafts and concurrent master-data changes. No business data was rewritten.
Web type checking, targeted ESLint and Git whitespace checks passed. This UI
follow-up was not separately exercised in an authenticated browser session.

## Phase 6 batch 1: authenticated backup artifacts

Read the complete root context/prompt and current architecture/phase notes;
working tree was clean at start. Added bounded AES-256-GCM streaming backup
artifacts with authenticated installation/schema/version/checksum/count metadata,
unique nonces, no-overwrite publication and private temporary plaintext. Four
artifact unit tests passed: round trip, wrong key/identity/schema, metadata/data/tag
corruption/truncation and invalid input/no-overwrite cleanup. Initial sandbox test
launch failed with EPERM; rerun with required subprocess permission passed.
Database type checking and eight-file PowerShell syntax checks passed.

## Phase 6 batch 2: real PostgreSQL backup/restore verification

Added host-only backup CLI and NTFS-protected key creation. A repeatable-read
exported snapshot binds dump and table counts. Restore checks use only a generated
disposable database; no existing database name can be supplied for overwrite.
Verified a PostgreSQL 18 Docker dump/encrypt/decrypt/restore round trip on Windows,
including ACL setup, matching restored counts/readiness, wrong-key rejection,
temporary cleanup and unchanged source fixture. The first real test exposed an
empty PGSERVICE setting; removing inherited libpq configuration fixed it and the
test passed. Added exact migration-history checks; final artifact tests (4) and
migration-aware real restore drill (1) passed. Database/test TypeScript and
targeted ESLint also passed.
CI is configured to use its service container; remote CI remains unverified.

User confirmed no code-signing certificate or SaaS provider is currently available.
Keep these external and do not provision paid services. Grace policy question is
pending. Remaining Phase 6 work is tracked in phase-6.md; official issuance gates
and customer data remain unchanged. Native PostgreSQL restore/cutover, scheduled
execution, installer signing/service/reboot, provider recovery and commercial
license/subscription integration are not yet complete.

## Phase 6 batch 3: signed entitlements and immediate read-only policy

User confirmed immediate read-only at trial/subscription expiry (no grace).
Added strict shared claim/envelope contracts, Ed25519 authenticity verification,
14-day trials, offline host/organization binding, SaaS organization binding,
sequence/clock rollback checks and perpetual-maintenance independence. Five
cryptographic/policy unit tests passed. Added operator-only audited grant import,
per-organization business-write enforcement after authentication/RBAC, and safe
read-only UI behavior without clearing the authenticated session. Production
fails closed without trust; existing unconfigured development stays writable.
HTTP integration passed for missing/expired grants, active perpetual rights after
maintenance expiry, preserved authorized reads, idempotent installation, rejected
rollback/wrong-host grants and unchanged data after rejected writes.

Before additive migration 0005, created a private NTFS-protected recovery key and
encrypted backup of the existing local database, then successfully restored and
verified all 26 archived tables in a separate temporary DB. Known Phase 5 schema
prefixes are supported for pre-upgrade backups; unknown history is rejected.
Applied 0005 and verified counts/fingerprints of all 23 existing business,
identity, financial, audit and grant tables unchanged; live sessions/throttle were
excluded because normal API use can update them. No existing permissions or
credentials were rewritten. Recovery materials remain ignored under .local;
an off-device copy remains the operator's responsibility.

Both new integration files passed (2 tests total), plus API/test TypeScript.
New workspace status presentation and final broad regression checks remain next.
Issuer/online activation, provider automation, signed installer/update, scheduling
and controlled disaster-recovery cutover remain unfinished Phase 6 work.

## Phase 6 batch 4: job reporting and signed update-package preflight

Added a one-shot PowerShell backup job using an approved Node executable hash,
private keys/configuration, exclusive overlap lock, unique encrypted artifacts,
full disposable restore and atomic last-success/failure status. Successfully ran
it on this Windows host with Docker PostgreSQL tools. No scheduled task was
registered; native-tool and unattended/reboot execution remain unverified.

Added host-only signed release-package preflight: domain-separated Ed25519
signatures, bounded manifests, version/known-schema checks, complete SHA-256 file
verification and rejection of path traversal, reserved names, alternate streams,
case collisions, unexpected files and Windows directory junctions. Five tests
passed. No package files were executed; no installer/update was installed.

Broad verification found one fsync-heavy filesystem unit test exceeding its
five-second default while builds ran concurrently; its local timeout is now 30s.
The subsequent full unit run passed 125 tests (before the five release tests were
added). Full integration initially lacked pnpm's host-CLI environment; the
documented `pnpm test:integration` rerun passed all 41 tests. Initial browser run
passed four workflows and reached the new read-only flow, but its final locator
matched both h1/h2; corrected it to the page-level heading. Final browser rerun,
new pre-upgrade-restore test and complete checks remain next.

## Phase 6 batch 5: recovery failure checks and runtime consistency

Verified the one-shot Windows job's failure path using a deliberately nonexistent
Docker container: it exited 1, recorded failure, preserved the previous successful
timestamp and every existing archive. A subsequent real backup/restore job passed.
Added explicit current-release compatibility reporting for restored backups and
a test covering pre-upgrade Phase 5 archives without claiming current API readiness.
Readiness now checks the entitlement table as part of the current schema.

Full compiler, lint, build, formatting, whitespace and nine-file PowerShell syntax
checks passed. Production dependency audit reported no known vulnerabilities.
Workspace engine requirements now match the verified Node 24.22.1+/pnpm 10.34.9
baseline, preventing normal installation under the previously crashing Node 22
toolchain; system installations were not changed. Backup archives are excluded
from Git and Docker contexts. The latest complete unit run passed 130 tests.
Final integration and Chrome/Edge runs are in progress. User-staged changes remain
staged; no commit or index rewrite was performed.

## Phase 6 continuation: final local checkpoint (2026-10-30)

Full unit run passed 130/130 and isolated integration passed 43/43. Chrome and
Edge each passed all six workflows. The extended read-only browser workflow
verifies disabled business editing for known expired state, re-enabling after
renewal, and retaining authorized historical access when a later write is rejected.
RBAC permissions are not rewritten to implement licensing. All production
entitlement/issuance checks remain server-side and independent.

API/web/test TypeScript, lint, production builds, compiled HTTP/assets/database/
OpenAPI/Origin smoke, migration drift and nine-file PowerShell syntax checks
passed. Final API smoke passed after the UI change. Both old Node and old pnpm
were explicitly rejected by offline lockfile-only engine checks; the lockfile
remained unchanged. Release tests passed again after adding a case-insensitive
reserved-manifest-path check. One late test-array formatting warning was corrected;
the final full lint, formatting and whitespace rerun passed.

Moved the CI backup-container expression to integration-step environment, where
GitHub's job context is available; remote CI remains unverified. Reference:
[GitHub context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability).

This is a verified local hardening checkpoint, not completion of commercial
Phase 6. Remaining work requires externally provisioned signing/issuer/hosting
and an elevated disposable Windows/LAN test environment: commercial signed
installer/update and controlled cutover, service/reboot/native PostgreSQL and
unattended scheduling, online activation/self-service SaaS onboarding and provider
renewal/backup operations. No production private key, paid service, scheduled task,
machine-wide service, certificate trust or firewall rule was installed. Existing
business data and user-staged changes are preserved; recovery material is private
under ignored .local paths and still needs an operator-managed off-device copy.

## Windows terminal toolchain selection repair

The user's terminal still selected system Node 22.13.0 and pnpm 9.15.4 after the
Phase 6 engine checks were enabled. Preserved those checks and system installs.
Added a Windows helper that validates/reuses compatible existing distributions,
copies them into a stable ignored .local/toolchain location without overwriting
an existing setup, and selects its bin directory for the current shell. Added
workspace VS Code terminal environment configuration for future terminals and
documented the one-command helper for existing/external PowerShell sessions.
No new runtime/dependency version or credential was introduced.

Verified helper reuse and a fresh PowerShell process with the resolved VS Code
environment: Node 24.22.1 and pnpm 10.34.9 resolve from .local/toolchain/bin.
The first db:up attempt passed engine checks but found Docker Desktop stopped;
started the already-installed application and successfully brought PostgreSQL
to healthy state. Argon2 native/hash verification, ten-file PowerShell syntax,
targeted formatting and Git whitespace checks passed. Actual VS Code terminal creation remains
a user action; existing open terminals cannot inherit another process's PATH.

## Phase 6 continuation: backup scheduling and health

Added explicit operator-configured daily/boot Task Scheduler definitions and
registration under a dedicated ordinary local account. Registration refuses an
existing task, mismatched credentials, direct local administrators, reparse paths,
untrusted writable dependencies/ancestors and public-readable private configuration.
No account creation, ACL modification, archive pruning or Docker scheduling occurs.
Definition generation is the default; actual registration requires elevation and
the dedicated account credential. Added CI definition checks.

Verified definition settings, escaping and unsafe-input rejection, including
loading the XML through the actual Windows Task Scheduler COM parser in memory.
Twelve PowerShell files parse successfully. No task was registered or executed.
Added backup:health with an explicit maximum age and nonzero status for failed,
missing, malformed, stale, old-schema or absent-artifact backups. Six focused tests
passed (the sandbox blocked Vitest subprocess startup; the approved subprocess
rerun passed). Database type checking, full regression checks and the final date
validation adjustment are being verified next. Native PostgreSQL, privileged task
registration/ACL provisioning, unattended/reboot execution and actual external
alert delivery remain unverified. No business data or staging was changed.

## Phase 6 continuation: publisher license tooling

Added publisher-only license:issue tooling, excluded from Docker build context
and not imported by the customer API/web build. Requires an externally supplied
encrypted Ed25519 PKCS8 key matching the approved public trust map. First issuance
is explicit; renewals/transfers authenticate the previous grant, preserve the
organization/edition, require the next sequence and a new entitlement ID, and
cannot issue a second trial. No production key, grant or commercial ledger was
created. The publisher remains responsible for identity/transfer approval and
the authoritative issuance register; this is not an online activation service.

Six issuer tests passed, including a real isolated CLI subprocess with ephemeral
encrypted keys, customer-verifier compatibility, protected failure logs and
no-overwrite behavior. Six backup-health tests passed again. Type checking and
targeted lint passed. Final full unit/build checks are next. Existing business
data, user credentials, configuration, Git index and billing compliance gates
are unchanged.

## Phase 6 continuation: publisher release signing

Added release:sign publisher tooling that inventories the actual staged tree,
validates version/schema/runtime metadata, signs with an approved encrypted
external key, refuses existing manifests and uses the real customer verifier
before success. Shared inventory also rejects case-colliding directories and
unknown files/sizes before reading their contents in customer verification.
Issuer tools remain outside customer API/web imports and the Docker context.

Seventeen focused license/release tests passed, including both actual publisher
CLI subprocesses with ephemeral encrypted keys, unchanged existing manifests,
tampering, rejected key/metadata/secret paths and native Windows junctions.
The prior full run passed 142 unit tests before these six release-publisher tests
were added. Full final checks are in progress. Application-level release signing
does not implement Windows Authenticode, privileged installer/update/recovery
cutover, online activation, SaaS onboarding/provider renewal or deployment.
Those remain unfinished. No production signer, license, service, task, certificate
trust, firewall rule, database or customer configuration was changed.

## Phase 6 deployment prerequisites confirmed

The user confirmed no disposable Windows VM/second client is available. Code-signing
credentials and a SaaS provider were already unavailable. Therefore the next
privileged Windows installer/service/reboot/LAN acceptance work cannot be completed
or claimed on this development laptop. Signed installer/assisted update/cutover and
SaaS onboarding/provider operations remain unfinished implementation as well as
deployment validation; these are not hidden behind a claim of Phase 6 completion.
No machine-wide substitute or weaker tax/certificate/permission gate was introduced.

During final review, bound backup health to the recorded authenticated schema
digest and the running release's migrations. A recently successful old-release
backup cannot appear current after a schema upgrade. Restore verification now
returns that digest and the Windows job records it. Existing status files without
the digest require a new verified backup, not a fabricated success marker.

Final verification: all 148 unit tests passed; both isolated PostgreSQL backup/
restore integration tests passed against the existing healthy development
container, including digest reporting and the older-schema case. Full workspace
type checks and API/web production builds passed; the final database rebuild
includes digest reporting. Twelve PowerShell files parse, the native Task Scheduler
in-memory XML check passes, and mocked ACL checks reject unsafe owners, ancestor
replacement, writable child dependencies and reparse points. Registration,
unattended execution, native PostgreSQL, reboot/LAN and remote CI remain unverified.
The prior 43-test integration and Chrome/Edge browser checkpoint is historical;
those full suites were not repeated for these operator-only additions.

Final full lint/Prettier and Git whitespace checks passed. The initial sandboxed
recursive type-check command encountered Windows subprocess EPERM; the approved
full rerun passed. No check failure remains unresolved for this local batch.

## Phase 6 continuation: quarantined recovery candidates

Implemented host-only backup prepare-recovery with explicit installation UUID
confirmation. It authenticates/decrypts a current-schema backup, restores only to
a newly generated database with PUBLIC connection privileges removed, verifies
migration history/table counts/readiness, invalidates copied login sessions and
appends an audit event in the candidate only. The retained candidate denies all
new database connections; live configuration/runtime grants remain untouched.
Ordinary verify still removes its disposable database. Unknown/old schema recovery
preparation fails without automatic migrations or a schema downgrade.

Focused unit, real PostgreSQL isolation/quarantine/failure and compiled CLI checks
passed: two unit tests and five real PostgreSQL tests, including the compiled CLI,
denied candidate connections/PUBLIC privileges, session invalidation, source
preservation, wrong-key/identity/corruption cleanup and old-schema rejection.
Database build, test TypeScript and targeted lint passed. No live recovery
candidate or customer-data operation has been performed; integration fixtures
are random isolated databases. The Windows VM,
code-signing, hosting and professional tax-review limitations remain unchanged.

## Phase 6 continuation: protected release staging

Added release:stage: signature/file preflight, a new private staging directory,
bounded copy/hash validation of the signed file list and final exact-manifest
verification. The Windows path applies NTFS ACLs before writing and checks owners,
reparse points and ancestor replacement permissions. POSIX restricts modes/owners
and handles root-owned sticky temporary directories. Downloads, existing staging
directories and unrelated operator material are never overwritten. No staged
code is executed and no service/configuration/cutover is changed.

All six staging tests passed in the full unit suite. The initial Windows
success-path tests correctly rejected the sandbox's
TEMP directory because another account has Modify/DeleteChild permissions there.
The fixture now uses a fresh directory under private Local AppData; the production
ancestor check was preserved, and all original staging/verifier/publisher checks
passed. Added a deterministic same-size mutation after preflight to exercise the
copy-time hash check and generated-child-only cleanup. This is locally testable
engineering, not Windows installer/reboot or
commercial deployment acceptance. The missing VM does not block these filesystem
or isolated database tests.

Final continuation verification: all 156 unit tests and all 46 integration tests
passed. The integration command was rerun through documented pnpm test:integration
after a direct Vitest invocation omitted npm_execpath, which the pre-existing
host CLI test requires (45/46 passed on that first invocation). No product change
was made to hide the harness error. The final run also checks an authenticated
archive with inconsistent counts, forcing failure after database creation/restore
and proving generated-database cleanup. Candidates are connection-disabled before
failure cleanup, so an interrupted DROP does not reopen them to new connections.

Full workspace/test TypeScript, production API/web builds, compiled frontend/API/
database/OpenAPI/Origin smoke, full lint/Prettier, Git whitespace and both Windows
script checks passed. One type-import lint finding and an integration-file
formatting warning were corrected before the final checks. The final database
package rebuild includes the cleanup hardening. No browser UI changed; Chrome/
Edge workflows were not repeated. POSIX staging branches/remote CI and native
Windows service/installer/LAN/reboot/unattended acceptance remain unverified.
User configuration, active business data and the Git index were preserved.

## Phase 6 continuation: explicit forward upgrades of recovery copies

Added an opt-in --upgrade-to-schema target for host-only recovery preparation.
The target must exactly match the installed trusted release's migration digest.
Without it, old backups still fail closed. The backup is authenticated and its
restored migration prefix/counts are checked before applying any migration to
the generated owner-only candidate. Only this release's existing SQL is used;
there is no caller-selected migration directory or downgrade path. The final
history/readiness must match the confirmed target before quarantine is retained.
Audit/result metadata distinguishes backup and upgraded schema digests.

Added read-only db:schema tooling to print the release-file digest without
database credentials or a connection. Initial focused verification passed four
unit tests and all nine backup/recovery/upgrade integration tests. This includes
old-backup/compiled CLI upgrades, original database/archive preservation and real
migration-failure cleanup. Final verification passed all 158 unit tests, all 50
isolated integration tests and the compiled runtime smoke check. Full type/build/lint/format checks and
both PowerShell checks passed after removing a redundant counter initializer.
No live database migration, service change, runtime grant rewrite or invoice
compliance bypass was performed. Windows deployment/VM and hosting gates remain.

The upgrade result reports the actual candidate table count and both original/
target digests. A deliberately conflicting view in an isolated fixture proves
migration failure cleanup after restore without touching repository SQL or the
original database. Current-schema preparation and ordinary verification remain
covered by the full suite. No browser UI changed, so browser workflows were not
repeated. Native Windows PostgreSQL/service/installer/reboot/LAN and remote CI
remain unverified. Existing development data/configuration and Git staging were
preserved; no live recovery candidate was retained outside test fixtures.

# MFA convenience update — 2026-11-06 (completed)

Resumed the interrupted change without altering the staged Platform Admin work.
Added the billing trusted-device schema/runtime access policy, opaque hashed
device credentials bound to password/MFA state, 30-day fixed expiry and token
rotation. Login still requires a password; enrollment is never bypassed.
SaaS mandatory MFA is now based on ownership or organization/member/role
administration, rather than everyday billing permissions. Offline MFA remains
optional and Platform Admin still requires MFA at each new sign-in.

Wired the explicit remember checkbox and Account security device list/revocation.
Password changes require a fresh MFA/recovery code when MFA is enabled. Password
changes, MFA changes and sign-out-all invalidate remembered devices. Database
migration generation and verification are underway; this checkpoint is not a
claim that the unfinished change has passed tests or been deployed locally.

Verification checkpoint: generated additive migration 0008_trusted_devices and
snapshot/journal, and added current readiness/runtime-role probes plus reviewed
prior-release recovery compatibility. Prepared recovery clears device trust so
old backups cannot resurrect remembered access. The five new MFA integration
cases passed. Seven real Chrome billing browser tests passed, including the
remember/login/reload/forget flow and existing desktop/mobile billing workflows.
API/web production builds and test TypeScript passed. The full unit run passed
282/283; its certificate recovery failure passed on an isolated six-test rerun.
The initial full integration run exposed one obsolete mandatory-MFA assertion
and a new recovery test assertion placed before quarantine was lifted; both test
issues are corrected and final reruns are pending. Docker was started without
resetting volumes. All database tests use disposable databases; no live migration
has been applied at this checkpoint.

Final verification: all 84 enabled integration tests passed (one existing opt-in
installer test skipped), including the five new security cases, the platform
auth/operations suite, and real backup/restore, recovery, upgrade and restricted
runtime grants. All 17 Chrome browser tests passed, covering both applications,
remembered-device use/revocation, refresh, existing billing and responsive UI.
The synthetic workspace fixture now mocks the new device-list endpoint; its
initial unmocked-read failure was fixed without weakening product behavior.
Workspace/test TypeScript, API/web production builds, repository lint/format and
whitespace checks passed. The earlier unit certificate failure passed all six
tests on its focused rerun; no certificate product code was changed.

Applied the additive migration to the confirmed loopback gst_dev database.
Runtime readiness passes; existing counts remain one organization, one user and
zero invoices. No existing billing/account data, environment secrets or staged
changes were replaced. Restart pnpm dev to use the feature; select the explicit
checkbox during the next billing MFA verification. Platform Admin still requires
MFA at each new login and fresh proof for sensitive commands. Native Windows
installer/service/reboot/LAN acceptance and production hosting remain outside
this change and are not newly verified.

# Error recovery UX — 2026-11-07 (completed)

Reviewed both transports, admin identity/operations/forms and billing workspace,
validation, account settings and editor error paths. Added code-based plain
language guidance with destinations for common security, licensing, payment,
tax, setup, stale-record and connectivity failures. Network failures do not
replay mutations; users are directed to verify operation/record state first.

Implemented an admin in-place identity dialog with cancel, keyboard/focus
handling and preserved source form. Only an explicit REAUTH_REQUIRED rejection
can be retried once after fresh server verification, preserving the same payload
and idempotency key. Invalid password/code responses do not sign out a valid
session. Added billing recovery actions, isolated unsaved-state handling for
business setup over an invoice, safe links to related records in a new tab and
field-named validation. Existing backend permissions/compliance gates remain.
Frontend builds/type checking have started; tests and final verification are
pending. No schema or live organization/security configuration changes.

Recovery UX checkpoint: frontend builds and test TypeScript passed. Four new
transport safety tests passed (one verified retry with unchanged submission,
no retry for unknown network failure, cancellation, and wrong-proof versus actual
expiry). All eleven Platform Admin integration tests passed, retaining MFA,
CSRF, authorization, redaction and durable-operation behavior. The first full
browser run passed the new in-place admin confirmation/one-commit case and other
admin/navigation checks; the new invoice recovery scenario needed to explicitly
reconfirm GST registration after saving setup. The test now performs that same
required user review; no registration/compliance check was relaxed. Final browser
rerun and repository checks are pending.

Shutdown-resume checkpoint: verified the saved change set and rebuilt every
workspace package and application successfully. Test TypeScript, all four retry
safety tests, repository lint/format and whitespace checks passed again. The
final browser run has passed all seven real billing scenarios, including setup
recovery without losing invoice inputs, invalid-proof handling, provider expiry
guidance and MFA. Remaining admin/workspace browser scenarios are running. No
source rollback, environment-secret rewrite or live data reset was needed.

Final verification after shutdown: all 18 Chrome browser tests passed, including
both admin and billing, mobile layouts, one-commit sensitive actions, cancellation,
wrong-password preservation, invoice setup recovery/save, field retention,
classification links, expiry explanations, existing MFA and record navigation.
All four new transport safety tests passed again; all eleven admin integration
tests had passed before interruption with unchanged authorization semantics.
Full workspace production rebuild, test TypeScript, repository lint/format and
whitespace checks passed. Added the operator/user recovery guide in
[error-recovery.md](error-recovery.md). Generic banners are not duplicated on
ordinary editor pages; active dialogs keep their own reachable errors. Specific
server expiry and customer-state details are retained alongside recovery advice.

No migration, license change, security bypass, environment-secret modification,
live database reset or Git staging/commit was performed for this UX update.
Restart billing/admin development processes to see the changes. Native Windows
installer/services/reboot/LAN acceptance and production deployment remain outside
this work and are not claimed as verified.

# Popup feedback — 2026-11-07 (completed)

Replaced page-top action feedback in both frontends with dismissible viewport
notifications. Both apps use the shared @gst/ui presentation component; customer
and admin runtime/security boundaries remain separate. Messages
stack in a fixed, bounded region and the host follows the active native dialog
so errors and recovery buttons stay visible/reachable above modal backdrops.
No automatic focus change or short error timeout; users explicitly dismiss
feedback. New messages are brought into the notification stack's visible area
without scrolling the page. Success, error and warning have separate visual
and live-region semantics. Existing field-native validation and contextual
issuance restrictions remain available by the affected controls.

Converted workspace/admin errors and successes, local form errors, account and
appearance feedback, onboarding errors, read-only warnings and business saves.
Removed duplicate member/role dialog copies of the workspace error. Added
explicit invoice save/preview success messages. Frontend builds passed; browser
coverage now checks error visibility after submitting long forms in both apps,
preserved values, dismissal and normal success/retry. Final verification pending.

Popup verification checkpoint: builds/type checks passed. The initial browser
run exposed an obsolete exact-alert-text assertion (notifications now include a
heading/dismiss button), followed by a real stale-success overlay that blocked a
new role dialog's Save button. The text assertion now checks the message content,
and notification lifecycle clears prior non-error confirmations on navigation
or entry into a different dialog. The latest browser run has passed settings and
role/member workflows; remaining long-form and regression checks are running.
Added repeated local-validation dismissal/retry coverage and kept source values
intact. No permissions, API mutations or security checks were changed.

Final verification: all 18 Chrome browser tests passed with real disposable
databases and synthetic layout fixtures. New assertions verify viewport bounds
and fixed positioning after errors at the bottom of business setup and payment
forms, repeated invalid amount submissions after dismissal, retained field
values, success feedback, and notifications inside Settings. Existing dialogs,
MFA, onboarding, licenses/payments, invoice editing/printing, desktop/mobile
layout, navigation and unsaved-change checks passed. Frontend production builds,
test TypeScript, repository lint/format and whitespace checks passed. Visually
inspected the dark mobile Settings success popup as well. No live data reset,
schema migration, dependency installation, environment-secret change or Git
staging/commit was performed. Refresh the running frontends to see the changes.

# Focused cleanup review — 2026-11-07 (completed)

Reviewed the staged recovery/notification changes without altering the user's
index. Consolidated byte-identical notification TSX/CSS into the private @gst/ui
workspace, consumed by both frontend builds. Removed the two duplicate copies,
obsolete member/role error props, unreachable recovery/security guidance and
legacy notification styling. The DOM observer now checks only dialog-related
mutations before relocating the notification host, rather than querying dialogs
for every ordinary form/text change. Existing popup, dialog and error recovery
behavior is retained.

Both request clients now reject malformed/null JSON replies rather than claiming
a mutation succeeded; unknown outcomes are never retried automatically. Added
focused tests for that behavior. Internal workspace linking used the existing
offline store with lifecycle scripts disabled. The lockfile diff contains only
the internal UI links/importer; no external package versions changed. Build,
browser, request-safety and static verification are underway. No data reset,
schema change, license change or secret rewrite.

Final cleanup verification: full workspace/application production builds and all
workspace/test TypeScript checks passed, including @gst/ui's standalone CSS/type
declarations. Six request-safety tests passed, including malformed success replies
on both transports; all 18 real/synthetic Chrome browser regressions passed with
the single shared notification implementation. Repository lint, formatting and
whitespace checks passed. The broad screen changes were retained because each
implements the requested feedback/recovery behavior; no unrelated business or
security redesign was introduced. The existing staged snapshot was preserved;
the consolidation/removal/new workspace files remain working-tree edits to stage
together before committing.

# Project-wide audit — 2026-11-07 (completed locally)

Started from a clean worktree. Inventoried tracked source/configuration across all
apps/packages, publisher tools, Windows scripts, tests and CI. Audit progress,
verified findings and remaining release boundaries are recorded in
[project-audit.md](project-audit.md). Strict unused-code diagnostics and dependency
ownership review precede removal; no live database/security configuration changes.

Batch 1: traced every workspace's dependency imports and public/CLI entry points;
removed the API's redundant Argon2 declaration, moved test-only OTPAuth to dev,
enabled strict unused compiler checks after a clean baseline, and simplified the
password capacity guard. Shared builds and four focused crypto tests passed.
The production registry audit reported zero known advisories across 153
production dependencies. RxJS remains as a NestJS runtime peer.

Batch 2: consolidated transaction-local platform session validation and applied
it to password changes, other-session revocation and existing platform mutations.
This closes a revoked/stale-session race after initial request authorization.
All 12 platform integration tests passed, including the new regression. Customer
identity already revalidates sessions and password state inside its mutations.

Batch 3: found and fixed an uncaught client validation error in draft discard
when the reason is only whitespace. Uses the existing field-error popup and
preserves entered data and cancellation checks. Browser coverage now verifies
repeat invalid submission without a mutation request before a valid discard.
Full regression checks are underway; no historical financial/signature formats
or immutable SQL migrations were rewritten.

Batch 4: completed the subsystem source/contract review and the four safe Windows
CI checks (27 PowerShell files parsed; task-definition/native-parser and mocked
deployment/update checks passed without machine mutations). Finalization had up
to 200 normalized-row inserts for 100 invoice lines under one organization lock;
it now uses one line insert and one tax-component insert, retaining the same
transaction, snapshot, numbering and database guards. Added a full-size 100-line
financial association/idempotent retry regression. All 290 unit tests passed in
the complete rerun. The first run had a CLI subprocess timeout during concurrent
build work; no production/test timeout was weakened. Full integration is running.

Batch 5: traced unused CSS candidates against all tracked TS/TSX/HTML/scripts and
the current sidebar/home markup. Removed approximately 600 lines belonging to
the replaced dashboard/sidebar/toolbar, including their obsolete responsive
rules. Kept live selectors in shared comma groups and dynamic theme swatches;
no layout redesign or new dependency. Full browser regression will use fresh
production builds of both frontends.

Batch 5 verification: the full integration run passed 86 tests across 14 files,
including both platform/customer backup/restore, permission/license/concurrency
and full-size invoice regressions. One separate installer-database test is opt-in
and is now running in its own fresh labeled Docker container. A CSS AST comparison
against HEAD confirmed all 544 retained selectors keep their declarations and
cascade order; only 126 unreachable selectors were removed. Browser verification
and final compiler/build/format checks remain.

Final verification after resuming: all existing audit changes were present and
the final command completed successfully. All 290 unit tests passed; all 87
integration tests passed (86 in the main run plus the opt-in fresh Docker-cluster
test). All 18 Chrome browser tests passed against fresh builds, including repeated
whitespace-only discard validation, valid cancellation, desktop/mobile layouts,
themes, both security domains, financial workflows and printing. Full repository
format/lint, workspace/test TypeScript and all application builds passed. The
isolated customer runtime contained 145 packages/6,549 entries and successfully
used its own Argon2/OTPAuth with external module fallback prohibited. Web CSS
decreased from 60.67 to 50.92 kB without changing retained rule declarations/order.

No source changes were skipped or overwritten on resume; the user's staged
snapshot was preserved. Final audit/verification notes were updated in the
working tree. No live database reset, migration rewrite, external dependency
version upgrade, native service/firewall/trust mutation, Git staging or commit
was performed by this audit. Production hosting/signing/custody and real isolated
Windows installer/reboot/LAN acceptance remain the existing external release
requirements, not claims established by these checks. Detailed scope, findings
and limits are in [project-audit.md](project-audit.md).
