# Guided daily workflows

These screens help you manage organizations and find the next action. They reuse
the existing security, licensing and invoice rules; completing a checklist does
not approve taxes, install a license or grant permissions.

For first-time local installation, use [guided setup](guided-setup.md). Start
Billing with `pnpm dev` and Platform Admin with `pnpm dev:admin`, or use
`pnpm setup:launch` for your existing guided-setup profile. Keep each site's
configured origin unchanged when opening it in the browser.

## 1. Add an organization in Platform Admin

Open **Organizations → Add organization**.

1. Choose **Online SaaS** or **Offline Windows**.
2. For online customers, choose whether to create a hosted organization or link
   an existing one. An existing mapping is verified by the restricted operator
   connection; it cannot overwrite customer accounts.
3. Enter the business/contact information. Offline customers must supply their
   existing organization UUID and installation UUID. You can import the
   registration descriptor exported by their Billing workspace instead of
   copying both IDs. The descriptor is metadata, not proof of installation.
4. Select **Review organization**, check the edition, identifiers and effect,
   then **Register organization**. Use **Edit details** to correct the review.
5. Keep the organization detail URL. Refresh reopens the same record. Pending
   provisioning appears as an operation; follow that operation rather than
   submitting another organization.

The form warns before abandoning unsaved work. Registration does not install a
license or remotely create accounts on an offline computer.

### Online owner setup

On the organization's **Overview**, follow **Hosted status and owner onboarding**:

1. If provisioning is pending, open its operation. Resolve its existing state
   first; do not recreate it under a new ID.
2. Once provisioning completes, select **Verify hosted status**.
3. If owner setup is incomplete, select **Generate owner setup link**. Confirm
   your platform password and fresh MFA code if requested in the dialog.
4. Share the private link with the intended owner yourself. It is single use,
   expires after 24 hours, and is only displayed during this page session. A
   replacement invalidates the previous link. A lost secret cannot be recovered
   from operation history.
5. The owner chooses their password on Billing. Existing users must authenticate
   as the intended recipient. Normal customer MFA/setup requirements still apply.
6. Verify hosted status again after owner setup. Recorded completion and current
   licensed access are separate checks.

Pending directory records cannot be edited as though onboarding were complete.
Offline organizations do not have a remotely managed owner-setup link.

## 2. Check a Billing workspace

Open **Overview → Workspace setup checklist**. Checks load when you expand it;
use **Refresh setup checks** after making changes.

The checklist links to account security, business/GST settings, customers,
catalog, system status and team access. It shows the last observation time and
only offers destinations permitted by your role. Ask your owner or the indicated
manager when your permissions do not allow a correction.

“Checked” describes that specific observation. An existing catalog item does not
prove its classification is correct for the supply date. Development license
access does not prove production readiness. Invoice calculation/finalization
still performs its normal validation, including e-invoice restrictions.

For configured offline installations, an organization owner can select **Export
offline registration** here. The JSON contains only its format/version,
organization UUID, installation UUID and business name. Share it with the
publisher to register the offline customer. No invoices, credentials or signing
keys are exported. Other members cannot export this descriptor.

## 3. Record terms, receipts and licensed access separately

Expand **Commercial workflow** on an Admin organization's **Overview** tab. Its links show the
normal order: terms → money received → license → application/delivery history.

Use **Subscription** for agreed software terms and **Payments** for receipts or
auditable corrections. Outstanding balance uses exact integer paise across all
active agreements, even when there are more than 100. Individual commercial
tables still show their recent 100 records; this batch does not add full
commercial/audit-history pagination.

Recording payment, replacing terms or recording a reversal never signs,
installs or revokes a license. These are internal commercial records, not
statutory GST invoices for the publisher's sales.

## 4. Hand a license request to the external signer

On the organization's **Licenses** tab:

1. Reconcile existing signed history before renewing. Check the full balance,
   entitlement type and exact dates. Date inputs use the displayed browser
   timezone; the immutable claims store UTC timestamps.
2. Select **Prepare request** and confirm the access effect. A trial is exactly
   14 days and cannot be repeated through a renewal. Future/expired grants do
   not confer current write access. Cancelling preserves your entries.
3. Select **Export signing handoff** for the frozen request. This is one JSON
   package containing its identifier, claims and signed predecessor, if any.
4. Give that package to the protected external signing environment. The portal
   neither stores private signing keys nor signs grants.

The existing publisher CLI accepts the new package as an alternative to the
legacy separate claims/predecessor inputs:

```powershell
pnpm license:issue --request <request.json> --key-file <encrypted-key.pem> --key-id <trusted-key-id> --trust <public-trust.json> --output <new-grant.json> --register <authoritative-register-folder> --register-id <expected-register-uuid>
```

The paths/IDs above are placeholders. Use the reviewed private signing procedure
to supply `ISSUER_KEY_PASSPHRASE`; never put a passphrase in a browser, command
argument, source file or shared document. The authoritative protected register
and expected register ID remain required. With `--request`, do not also supply
`--claims`, `--previous-grant` or `--new-organization`.

The signer validates history and approves the sequence. A downloaded request does
not create signing authority or permit resetting the register. If issuance
committed but output delivery failed, export the already committed envelope using
the existing register procedure; do not sign another renewal. Legacy separate
exports remain available for existing reviewed procedures. See
[license operations](licensing-operations.md) for signing custody and recovery.

### Import and apply or deliver

1. In **Import signed grant or reconcile history**, choose the frozen request
   to match, or history reconciliation for a complete verified chain.
2. Choose the original signed JSON file. A single envelope or ordered array of
   up to 100 is supported, at most 900,000 bytes. Pasted JSON remains a fallback;
   do not supply both sources. Never upload a private key or publisher register.
3. **Verify and import** runs the existing server signature, trusted-key, exact
   request, organization, edition, binding and history checks. File selection
   alone is explicitly unverified. Errors preserve your selected source for
   correction/retry.
4. For SaaS, use **Apply approved grant**, confirm its effect and inspect the
   durable operation. Import alone does not apply access. Refresh the relevant
   status after completion; the customer's own license check decides access.
5. For offline, **Download signed grant** and use the existing host installation
   procedure. Record delivery or operator-reported installation separately.
   Neither is live activation, remote revocation or synchronization.

If a response is lost, retry the unchanged form. The frozen request keeps its
claims/idempotency key; it does not invent a second claim timestamp or identifier.
Changing inputs represents a new submission. Inspect saved history first when
the outcome is unclear.

## 5. Find and recover an operation

Open **Operations**. System checks remain above the searchable operation list.
Filter by operation ID (or a hexadecimal ID fragment), state, action or platform
organization UUID. Results are ordered by creation time and ID, 50 per page;
the bounded search permits offsets up to 10,000. Narrow your filters for older
history. Follow a result to its stable `#/operations/<id>` URL. Refresh and
browser Back/Forward preserve operation routes and filter URLs.

| State     | Meaning and next action                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending   | Waiting for the worker. Refresh; ask the host operator to check processing and the billing connection if it stays pending.                      |
| Running   | Processing. Wait and refresh the same operation.                                                                                                |
| Retryable | Reconciliation is needed. Resolve the reported cause, then retry this operation. Billing receipts protect against duplicate commits.            |
| Conflict  | Saved state conflicts with the request. Inspect history with the operator. A new ID does not fix the conflict.                                  |
| Completed | A committed billing receipt was confirmed. This is historical completion, not a promise about current subscription, owner setup or pause state. |

Operation pages show attempts and timestamps without exposing command payloads.
Retry still requires fresh authorization. If identity confirmation opens, finish
it in place; do not bypass MFA. A read failure offers refresh/recovery instead of
pretending work completed. The list does not auto-refresh: use **Refresh** to
observe subsequent progress.

On an online organization's **Subscription** page, the last verified write-pause
state and latest pause/resume request are shown separately. **Verify hosted
status** obtains another observation. Resuming removes only the manual pause;
expiry, permissions and tax/compliance restrictions remain in force.

## Verification boundaries

Tests and their latest results are recorded in [review coverage](review-coverage.md).
These workflows add no database migrations, deployment provider, generic command
runner, remote offline control or signing-key custody. Backup/recovery interfaces,
Windows lifecycle interfaces and provider-bound deployment remain later plan
batches. Real Windows installer/reboot/LAN acceptance remains postponed.
