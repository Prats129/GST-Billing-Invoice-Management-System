# Invoice renderer

`renderInvoice(InvoicePrintData)` returns escaped, script-free HTML for `a4.v1`.
The caller supplies server-calculated data or a historical snapshot. A missing
number always produces a prominent draft warning. This package cannot issue a
document, sign it, generate an IRN or provide a PDF service.

The matching immutable stylesheet is `apps/web/public/invoice-a4-v1.css`, served
at `/invoice-a4-v1.css`. Keep it available for historical copies. Change financial
or historical presentation semantics by adding a new renderer/style version,
not by changing old snapshots. The application displays the HTML in an iframe
with `allow-same-origin allow-modals` and no script permission, preserving CSP.
Browser printing uses the browser's print/Save as PDF facilities.

Tests check text escaping, draft identification, correction references and version
selection. Actual Chrome/Edge workflow checks are in `tests/browser/auth.spec.ts`;
hardware printers and native Windows deployment remain separate release checks.

Bounded PNG logos are embedded from saved supplier data, after format validation;
remote URLs/SVG are rejected. Value-adjustment notes do not present their monetary
basis as a physical item quantity. Cancelled copies overlay the append-only
cancellation reason/date while preserving the original financial snapshot and number.
