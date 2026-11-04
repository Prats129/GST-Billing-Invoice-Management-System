# Phase 4 — deterministic GST calculation engine

Release update (2026-11-05): the owner confirmed CA approval for the supported
ordinary-invoice scope. Engine 1.0.1 updates release metadata without changing
the financial algorithms below. Ordinary invoice issuance is now available
through the guarded API; e-invoicing, issued corrections and issued cancellation
remain outside that release. See [Phase 5](phase-5.md). Dated preview-only
acceptance records below describe the earlier implementation state.

Scope: a pure, versioned, browser/server-compatible package. No HTTP, database,
invoice numbering, finalization or printing. Phase 5 connects the engine to the
authorized invoice lifecycle. Existing master data and credentials remain unchanged.

## Acceptance and supported boundary

- Exact decimal-string inputs and BigInt arithmetic; no binary floating-point
  financial arithmetic or external financial dependencies.
- Quantities with unit precision, inclusive/exclusive prices, fixed/percentage line
  discounts and proportional invoice discounts with deterministic paise allocation.
- CGST/SGST, CGST/UTGST or IGST from supported guided place-of-supply facts; nil
  and exempt remain distinct. No automatic HSN-to-rate guesses or seeded tax rates.
- Effective-dated reviewed classification selection; newer applicable unreviewed
  revisions block rather than falling back to an old reviewed rate.
- Explicit price/classification/place overrides require caller-supplied trusted
  authority and retain actor/reason/source provenance. This library does not
  authenticate callers; future HTTP adapters must derive authority server-side.
- Strict versions/scope/date/bounds, safe errors, serializable deterministic output,
  reconciliation and adversarial/golden/generated tests. Inputs are not mutated.
- Build/types/lint/format/unit and existing application regressions. Progress after
  each batch in review-coverage.md; no claims of untested native Windows deployment.

Supported transactions are independent ordinary domestic forward-charge supplies
by a confirmed regular GST supplier, unrelated parties and sole monetary consideration.
Goods: direct movement/no movement for registered buyers, or the invoice/delivery
address rule for unregistered buyers. Services: only the general domestic rule,
excluding special-service rules and e-commerce. All lines must resolve to one place
of supply. Explicitly exclude SEZ, imports/exports/zero-rating, reverse charge, cess,
composition/non-GST supplies, composite/mixed valuation, third-party bill-to/ship-to,
installation/conveyance supplies, post-supply discounts and corrections.

## Version 1 engineering calculation policy

- Dates from 2026-10-29 only. Current jurisdiction metadata is not a historical GST
  rules database. Unknown rule versions fail; no ambient date/network/config inputs.
- At most 1000 lines and 100 classification revisions per line. Quantity has up to
  9 whole/6 decimal places, unit price 14 whole/4 decimals and GST rate 2 decimals.
  Money is bounded to 16 whole digits/2 decimals. Reject overflow, never clamp.
- Apply line discounts to the exact quantity × entered unit price, on that price's
  inclusive/exclusive basis; then round the remaining priced amount half-up to paise.
  Derive the actual displayed line discount by subtraction so the values reconcile.
- Inclusive amounts reverse-extract combined GST using Rule 35, rounding combined
  tax half-up to paise; the remaining paise are the exclusive supply value.
- Invoice-wide discounts are explicitly **tax-exclusive**, across eligible rounded
  supply values after line discounts (including eligible nil/exempt lines). This
  makes mixed inclusive/exclusive prices comparable. Percentage discounts apply
  once to the eligible value; fixed discounts cannot exceed it. Floor proportional
  shares, then distribute remaining paise by descending remainder, ASCII line-ID
  tie break. Ineligible lines receive zero. No positive discount on zero eligibility.
- Recompute tax on discounted exclusive values. Inclusive lines with no allocated
  invoice discount preserve their reverse-extracted tax and original priced amount.
- Line combined GST rounds half-up. For intra-state supplies, reconcile within
  each rate/category group: central tax receives half the group's combined tax,
  half-up to paise; allocate that central total proportionally among line tax amounts
  with the same stable residual method. State/territory tax is each line's remainder.
  This preserves every line total and keeps equal-rate group components within one
  paisa, instead of systematically putting every odd paisa into central tax.
- Totals and rate summaries sum rounded lines; never recompute tax from aggregated
  bases. Keep taxable, nil and exempt values separate. No automatic invoice-level
  whole-rupee rounding; a separately named exact rounding helper is available.

The allocation/paise reconciliation conventions above are explicit engineering
choices, not a claim that legislation prescribes this exact algorithm. Results are
calculation previews with issuanceAllowed=false. Professional tax review/sign-off,
statutory rate notifications/conditions, change-of-rate/time-of-supply, invoice
document rules and e-invoice applicability remain commercial issuance gates.

## Source review (2026-10-29)

- [CGST section 15](https://taxinformation.cbic.gov.in/content-page/explore-act/1000284/1000001):
  ordinary transaction value and recorded pre/at-supply discounts. The page flags
  a 2026 post-supply amendment with unnotified commencement; that workflow is excluded.
- [Rule 35](https://cbic-gst.gov.in/pdf/24092021-CGST-Rules-2017-Part-A-Rules.pdf):
  inclusive-tax extraction formula. This older official consolidation is used only
  for that formula, not current rate/threshold assumptions.
- [IGST intra-state boundary](https://taxinformation.cbic.gov.in/content-page/explore-act/1000616/1000001),
  [general domestic service place of supply](https://taxinformation.cbic.gov.in/content-page/explore-act/1000620/1000001/hotel/ACTS),
  [IGST goods/service baseline](https://cbic-gst.gov.in/hindi/IGST-bill-e.html):
  supplier location plus legally determined place of supply; special cases excluded.
- [Circular 209/3/2024](https://gstcouncil.gov.in/sites/default/files/2024-09/circular-no-209-03-2024.pdf):
  unregistered goods recipient invoice/delivery-address treatment, superseding the
  old goods-movement/no-movement default for those buyers.
- [CGST section 170](https://www.indiacode.nic.in/indiacode/bitstream/123456789/15689/1/A2017-12.pdf):
  whole-rupee statutory payment rounding is kept separate from preview line values.
- [Jurisdiction definitions](https://www.indiacode.nic.in/bitstream/123456789/15689/5/a2017-12.pdf)
  and [Ladakh legal adaptation](https://upload.indiacode.nic.in/showfile?actid=AC_CEN_3_20_00071_201934_1568889824041&filename=213522.pdf&type=order):
  UTGST territories include Ladakh; Delhi/Jammu and Kashmir/Puducherry use SGST.

Source review is not a professional certification or a blanket current-law guarantee.
Do not issue invoices using this preview package until the release gates are satisfied.

## Local engineering acceptance (2026-10-29)

Implementation and local verification are complete. Frozen offline installation,
production package/API/frontend build, full workspace/test TypeScript, lint and
formatting passed. Unit tests passed 105/105, including 300 generated carts, 600
allocation cases, precision/overflow/authority/history/jurisdiction boundaries and
a 1000-line cart. Existing DB/HTTP integration passed 25/25, and all three application
workflows passed in both Chrome and Edge. Compiled-app startup smoke passed.

Independent arithmetic verification matched 400 cases using System.Decimal; browser
bundle verification matched Node exactly on 403 cases in each of Chrome and Edge.
The runnable example returned INR250 supply value, INR45 GST and INR295 total.
These checks verify engineering behavior, not professional approval of tax policy.

The interrupted verification resumed from existing changes. Docker/PostgreSQL was
stopped; the existing container/volume was restarted before rerunning the failed
test setup. No credentials, business data, API/UI behavior, schema/migration files
or Git staging were modified by Phase 4. Only the existing contracts workspace
dependency was linked; no new external dependency was introduced.

Detailed batches/failures/recovery/evidence are in review-coverage.md. Professional
tax sign-off and actual issuance/e-invoice gates remain pending. Native Windows
service/LAN HTTPS/firewall/reboot and remote CI validation remain separate release
work. Phase 5 implements the invoice lifecycle, corrections, snapshots and printing.
