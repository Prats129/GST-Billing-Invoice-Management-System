# Billing engine

Pure synchronous GST calculation previews shared by offline/SaaS and browser/server.
Financial inputs/outputs are decimal strings. Internal financial arithmetic uses
scaled BigInt integers and exact quotients; no binary floating-point money math.
There is no database, HTTP, filesystem, clock, random source or authentication in
the engine. Its only dependency is the existing workspace contracts package.

From the repository root:

```sh
pnpm build:packages
node packages/billing-engine/examples/calculate.mjs
pnpm test
```

The synthetic example calculates 2.5 × INR100 = INR250 supply value, INR45 combined
tax (INR22.50 CGST + INR22.50 SGST), INR295 total. Its HSN/rate is an arithmetic
fixture, not a tax notification or classification recommendation.

```ts
import { calculateInvoice } from '@gst/billing-engine';
import type { CalculationRequest } from '@gst/contracts';

const result = calculateInvoice(validatedMasterDataSnapshot);
// result.policy.issuanceAllowed is always false in this phase.
```

`calculateInvoice` validates unknown input and returns canonical quantity (6dp),
price (4dp), rate (2dp), component rate (3dp) and money (2dp) strings. Each result
retains engine/rule/rounding versions, selected classification source, resolved
place-of-supply basis, explicit overrides, lines, rate groups and reconciled totals.
Inputs are not mutated. `BillingCalculationError` supplies stable code/path fields
without echoing financial payloads or credentials.

Discount semantics are intentional: line discounts use the entered price's
inclusive/exclusive basis; invoice discounts use eligible **tax-exclusive** values.
Therefore a fixed invoice discount also reduces related GST; it is not a fixed
tax-inclusive reduction from the final payable. Nil/exempt eligibility is explicit.

`selectTaxRevision({supplyDate, revisions})` selects by greatest applicable
effective-from date, then revision sequence. A winning unreviewed revision blocks.
The caller must load the complete relevant history for the supplied date, not
silently pass a truncated history/list-page result. The engine cannot detect
omitted database rows or authenticate a supplied review/authority snapshot.

Overrides require a second, trusted `{actorId, permissions}` argument. Supported
capabilities are `price.override`, `tax.override`, `place_of_supply.override`.
Do not accept this argument or trusted catalog prices/reviews from an HTTP body.
The invoice API loads current tenant data/permissions itself and audits
the result in the finalization transaction. Overrides cannot enable unsupported
scenarios or bypass the baseline classification review. Return values are previews,
not permission to issue a document or a substitute for an IRP workflow.

`roundToNearestRupee(amount)` is a separate exact nonnegative-money helper returning
the rounded amount and signed adjustment; it never changes preview invoice totals
and does not determine which statutory liability or document should be rounded.

See [Phase 4 policy and source review](../../docs/phase-4.md) for supported scenarios,
date/amount limits, allocation/rounding conventions and professional approval gates.
Phase 5 implements authorized drafts/finalization/snapshots/corrections/printing.

`calculateValueCorrection(original, correction, prior)` consumes trusted immutable
original/prior outputs and a validated correction request. Under
`original-value-adjustments.v1`, debits use original classification/rates; partial
credits proportionally consume remaining original plus debit values and component
paise after earlier credits. A final reversal consumes exact residuals. It never
changes physical quantities, infers replacement rates or authorizes tax reduction.
Server adapters must authorize, serialize, revalidate caps at finalization and retain
the original/prior snapshot identities. Commercial issuance stays blocked by the
same pending policy. See [Phase 5](../../docs/phase-5.md) for precise boundaries.
