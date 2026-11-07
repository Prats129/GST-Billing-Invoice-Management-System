# Recovering from common errors

Both applications explain common errors and keep entered form values when an
action fails. Read the message before retrying. A network failure does not prove
that a write failed: check the saved record or operation history first.

Action errors, successes and warnings appear in a fixed notification stack that
stays visible while the page scrolls. Notifications can be dismissed and do not
take keyboard focus away from the form. They stay above an active dialog and
retain recovery buttons. Read important messages before dismissing them. Native
field validation and permanent explanations beside disabled controls remain
close to the relevant field/action.

Old success/warning confirmations clear when navigating or opening another
dialog so they do not cover the next action. Errors remain until dismissed or
resolved. Dismissing a local validation error does not suppress the next invalid
submission; the error can be shown again with the entered values preserved.

## Platform Admin

- Sensitive actions open **Confirm your identity** on the current page. Enter
  your current platform password and a fresh authenticator or unused recovery
  code. Verification retries only the explicitly blocked request, once, using
  the same payload and submission key. Cancel leaves the source form intact.
- A wrong verification password/code keeps a valid admin session open. TOTP
  codes cannot be reused; wait for the next code if necessary. Actual expiry
  still requires signing in again.
- Payment balance and adjustment errors point to **Payments**. License history,
  binding and signature problems point to **Licenses**. Correct records through
  their normal audited workflows; never delete history to clear an error.
- Stale versions require the latest record. **Reload latest page** asks before
  discarding unsaved forms. Copy any information you need to retain first.
- **Operations** explains pending, running, confirmed, retryable and conflicting
  states. A retryable connection error needs the host operator to check the
  restricted SaaS connection; a state conflict requires reconciliation. Do not
  create another organization to work around a pending operation.
- An address rejection requires the exact configured admin origin. `localhost`
  and `127.0.0.1` are distinct origins; disabling Origin/CSRF checks is not a fix.

## Billing workspace

- Business setup and applicability errors offer **Open business setup** to an
  authorized business administrator. It opens over the invoice and has separate
  unsaved-change protection. Save, close and calculate the invoice again. The
  invoice's entered values stay on its page.
- Item tax-review and customer GSTIN/address errors link to **Catalog** or
  **Customers** in a new tab for users with those permissions. Fix the affected
  record, return to the invoice, reselect an updated customer where needed and
  calculate again. Others must ask an authorized owner/reviewer for help.
- Connection problems offer **Check system status**. Validation identifies the
  field that needs attention. Ordinary permission/verification errors do not
  refresh away an open invoice; genuine expired sessions and mandatory security
  requirements still restrict access.
- A provider write pause or inactive entitlement requires provider action.
  Existing authorized records and printing remain available. A payment entry,
  role change or UI retry does not grant a signed entitlement.
- Required e-invoicing, tax review and release/compliance restrictions remain
  enforced. Enter the true applicability; selecting a false status is not a
  workaround for unavailable IRP integration.

No mutation is automatically retried after an unknown network or server failure.
Refreshing status reads current state; it does not repeat a financial or license
operation. Browser tabs and verification dialogs do not bypass permissions.
