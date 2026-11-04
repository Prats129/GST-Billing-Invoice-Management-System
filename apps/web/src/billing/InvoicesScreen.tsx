import { PageActions, useUnsavedChanges } from '../PageActions.js';
import { useEffect, useRef, useState } from 'react';
import {
  catalogPageSchema,
  customerPageSchema,
  indianStates,
  invoiceDraftSchema,
  invoicePageSchema,
  invoicePreviewSchema,
  invoiceRecordSchema,
} from '@gst/contracts';
import type {
  Address,
  CatalogView,
  CustomerView,
  InvoiceDraft,
  InvoiceDraftLine,
  InvoicePreview,
  InvoicePrintData,
  InvoiceRecord,
  InvoiceSummary,
  CalculationDiscount,
  DirectoryPage,
} from '@gst/contracts';
import { renderInvoice } from '@gst/invoice-renderer';
import { ApiError, securityRequest } from '../security-api.js';
import { Badge, Dialog, EmptyState, Icon } from '../ui.js';
import {
  AddressFields,
  DirectoryPagination,
  formatPrice,
  FormError,
  readAddress,
  useDirectory,
} from '../business/shared.js';
import type { BusinessScreenProps } from '../business/shared.js';
import { TaxOverrides } from './TaxOverrides.js';
import { CorrectionDialog, CancellationDialog } from './DocumentActions.js';

const today = () =>
  new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const stateLabel = (code: string) =>
  `${indianStates.find(([state]) => state === code)?.[1] ?? 'Unknown state'} (${code})`;
const blankAddress: Address = {
  line1: '',
  line2: '',
  city: '',
  stateCode: '27',
  postalCode: '',
};
function Discount({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CalculationDiscount;
  onChange: (v: CalculationDiscount) => void;
}) {
  return (
    <div className="invoice-discount">
      <label>
        {label}
        <select
          aria-label={label}
          value={value.kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'none'
                ? { kind: 'none' }
                : { kind: e.target.value as 'amount' | 'percent', value: '0' },
            )
          }
        >
          <option value="none">No discount</option>
          <option value="percent">Percentage (%)</option>
          <option value="amount">Fixed amount (INR)</option>
        </select>
      </label>
      {value.kind !== 'none' && (
        <label>
          {label} value
          <input
            aria-label={`${label} value`}
            inputMode="decimal"
            required
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
function Picker({
  kind,
  basePath,
  onCustomer,
  onItem,
  onClose,
}: {
  kind: 'customers' | 'catalog';
  basePath: string;
  onCustomer: (v: CustomerView) => void;
  onItem: (v: CatalogView) => void;
  onClose: () => void;
}) {
  const schema = kind === 'customers' ? customerPageSchema : catalogPageSchema;
  const directory = useDirectory<CustomerView | CatalogView>(
    `${basePath}/${kind}`,
    schema,
    true,
  );
  return (
    <Dialog
      title={kind === 'customers' ? 'Choose customer' : 'Add invoice item'}
      onClose={onClose}
    >
      <form
        role="search"
        className="invoice-picker-search"
        onSubmit={(e) => {
          e.preventDefault();
          directory.search(
            String(new FormData(e.currentTarget).get('q') ?? ''),
          );
        }}
      >
        <label>
          Search {kind}
          <input name="q" maxLength={80} placeholder="Name or code" />
        </label>
        <button className="button button-secondary">Search</button>
      </form>
      <FormError message={directory.loadError} />
      {directory.loading ? (
        <p role="status">Loading…</p>
      ) : directory.items.length === 0 ? (
        <p>
          No active records found. Add them in{' '}
          {kind === 'catalog' ? 'Catalog' : 'Customers'} first.
        </p>
      ) : (
        <ul className="invoice-picker-list">
          {directory.items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.code}
                  {'price' in item
                    ? ` · ${formatPrice(item.price)} · ${item.priceIncludesGst ? 'incl.' : 'excl.'} GST`
                    : ''}
                </small>
              </div>
              <button
                className="button button-secondary"
                onClick={() => {
                  if ('price' in item) onItem(item);
                  else onCustomer(item);
                  onClose();
                }}
              >
                Select {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <DirectoryPagination
        offset={directory.offset}
        count={directory.items.length}
        hasMore={directory.hasMore}
        loading={directory.loading}
        onChange={directory.setOffset}
      />
    </Dialog>
  );
}
function PrintPreview({ data }: { data: InvoicePrintData }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const html = renderInvoice(data);
  useEffect(() => setReady(false), [html]);
  return (
    <section className="card invoice-print">
      <div className="section-heading">
        <div>
          <h2>{data.number ? 'Document copy' : 'Draft print preview'}</h2>
          <p>A4 layout · browser Print / Save as PDF</p>
        </div>
        <button
          className="button button-secondary"
          disabled={!ready}
          onClick={() => frame.current?.contentWindow?.print()}
        >
          Print {data.number ? 'document' : 'draft'}
        </button>
      </div>
      <iframe
        ref={frame}
        title="Invoice A4 preview"
        sandbox="allow-same-origin allow-modals"
        srcDoc={html}
        onLoad={() => setReady(true)}
      />
    </section>
  );
}
export function InvoicesScreen(props: BusinessScreenProps) {
  const {
    basePath,
    permissions,
    run,
    mutate,
    busy,
    error,
    onClearError,
    readOnly = false,
  } = props;
  const canManage = !readOnly && permissions.includes('invoices.manage');
  const [documentAction, setDocumentAction] = useState<
    'correction' | 'cancel' | null
  >(null);
  const [page, setPage] = useState<DirectoryPage<InvoiceSummary>>({
    items: [],
    hasMore: false,
  });
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState<InvoiceRecord | null | undefined>(
    undefined,
  );
  const [customer, setCustomer] = useState<CustomerView | null>(null);
  const customerRegistrationError =
    customer?.gstin && customer.gstin.slice(0, 2) !== customer.address.stateCode
      ? `Check this customer's billing details: the GSTIN is for ${stateLabel(customer.gstin.slice(0, 2))}, but the saved billing address is in ${stateLabel(customer.address.stateCode)}. Open Customers, edit this customer, and correct the GSTIN or billing-address state to match their registration. Then select the customer again. Changing the delivery address below will not fix this mismatch.`
      : '';
  const [itemNames, setItemNames] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<'customers' | 'catalog' | null>(null);
  const [lines, setLines] = useState<InvoiceDraftLine[]>([]);
  const [discount, setDiscount] = useState<CalculationDiscount>({
    kind: 'none',
  });
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [recordPrint, setRecordPrint] = useState<InvoicePrintData | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [finalizeKey, setFinalizeKey] = useState(() => crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (readOnly) setDocumentAction(null);
  }, [readOnly]);
  const reload = () => setAttempt((v) => v + 1);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void securityRequest<DirectoryPage<InvoiceSummary>>(
      `${basePath}/invoices?offset=${offset}`,
      undefined,
    )
      .then((data) => {
        if (active) setPage(invoicePageSchema.parse(data));
      })
      .catch(() => {
        if (active)
          setLoadError(
            'Could not load invoices. Refresh your workspace access and try again.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [basePath, offset, attempt]);
  const changed = () => {
    setDirty(true);
    setPreview(null);
    setRecordPrint(null);
  };
  function open(record: InvoiceRecord | null) {
    if (record) record = invoiceRecordSchema.parse(record);
    onClearError();
    setEditor(record);
    setCustomer(null);
    setLines(record?.draft.lines ?? []);
    setDiscount(record?.draft.invoiceDiscount ?? { kind: 'none' });
    setPreview(null);
    setRecordPrint(record?.snapshot ?? null);
    setDirty(false);
    setCreateKey(crypto.randomUUID());
    setFinalizeKey(crypto.randomUUID());
    setItemNames(record?.lineDescriptions ?? {});
  }
  function read(): InvoiceDraft {
    if (customerRegistrationError)
      throw new ApiError(
        400,
        'CUSTOMER_REGISTRATION_MISMATCH',
        customerRegistrationError,
      );
    const data = new FormData(form.current!);
    if (!customer && !editor)
      throw new ApiError(
        400,
        'INVALID_INPUT',
        'Choose a customer before calculating or saving.',
      );
    const result = invoiceDraftSchema.safeParse({
      version: editor?.version ?? 0,
      customerId: customer?.id ?? editor?.draft.customerId,
      issueDate: data.get('issueDate'),
      supplyDate: data.get('supplyDate'),
      deliveryAddress: readAddress(data),
      goodsTreatment: data.get('goodsTreatment'),
      ordinarySupplyConfirmed: data.get('ordinarySupplyConfirmed') === 'on',
      lines,
      invoiceDiscount: discount,
      notes: data.get('notes'),
      terms: data.get('terms'),
    });
    if (!result.success)
      throw new ApiError(
        400,
        'INVALID_INPUT',
        `Check ${result.error.issues[0]?.path.join('.') ?? 'invoice details'}: ${result.error.issues[0]?.message ?? 'invalid value'}`,
      );
    return result.data;
  }
  const updateLine = (index: number, value: Partial<InvoiceDraftLine>) => {
    setLines((old) =>
      old.map((line, i) => (i === index ? { ...line, ...value } : line)),
    );
    changed();
  };
  async function calculate() {
    const response =
      editor && readonly
        ? await mutate<InvoicePreview>(
            `${basePath}/invoices/${editor.id}/preview`,
          )
        : await mutate<InvoicePreview>(`${basePath}/invoices/preview`, read());
    setPreview(invoicePreviewSchema.parse(response));
    setFinalizeKey(crypto.randomUUID());
  }
  const readonly =
    Boolean(editor && editor.status !== 'draft') ||
    Boolean(editor?.originalId) ||
    !canManage;
  if (editor === undefined)
    return (
      <section className="surface directory business-directory">
        <PageActions>
          {canManage && (
            <button
              className="button button-primary"
              onClick={() => open(null)}
            >
              <Icon name="plus" size={16} />
              New invoice
            </button>
          )}
        </PageActions>
        <FormError message={error || loadError} />
        <div className="invoice-list-banner">
          Create and review drafts, then finalize supported invoices for
          businesses assessed as not requiring e-invoicing.
        </div>
        {loading ? (
          <p role="status" className="invoice-padding">
            Loading invoices…
          </p>
        ) : page.items.length === 0 ? (
          <EmptyState icon="roles" title="Your first invoice starts here">
            Choose a customer and add products or services from your catalog.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Customer</th>
                  <th>Issue date</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {row.number ??
                          (row.documentType === 'credit_note'
                            ? 'Credit note draft'
                            : row.documentType === 'debit_note'
                              ? 'Debit note draft'
                              : 'Invoice draft')}
                      </strong>
                    </td>
                    <td>{row.customerName}</td>
                    <td>{row.issueDate}</td>
                    <td>
                      <Badge>
                        {row.status === 'draft'
                          ? 'Draft'
                          : row.status === 'cancelled'
                            ? 'Cancelled'
                            : 'Finalized'}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="button button-quiet"
                        onClick={() =>
                          void run(async () =>
                            open(
                              await securityRequest<InvoiceRecord>(
                                `${basePath}/invoices/${row.id}`,
                                undefined,
                              ),
                            ),
                          )
                        }
                      >
                        Open document
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DirectoryPagination
          offset={offset}
          count={page.items.length}
          hasMore={page.hasMore}
          loading={loading}
          onChange={setOffset}
        />
      </section>
    );
  return (
    <div className="invoice-workspace">
      <PageActions>
        <button
          className="button button-quiet"
          onClick={() => {
            if (
              !dirty ||
              window.confirm('Leave this invoice and discard unsaved changes?')
            ) {
              setEditor(undefined);
              onClearError();
              reload();
            }
          }}
        >
          ← All invoices
        </button>
        <Badge>
          {editor?.number ??
            (editor?.originalId
              ? editor.documentType === 'debit_note'
                ? 'Debit note draft'
                : 'Credit note draft'
              : 'New invoice draft')}
        </Badge>
      </PageActions>
      <FormError message={error} />
      <form
        ref={form}
        key={editor?.id ?? 'new'}
        onChange={changed}
        onSubmit={(e) => {
          e.preventDefault();
          const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
            'value',
          );
          void run(async () => {
            if (action === 'save') {
              const draft = read();
              const record = await mutate<InvoiceRecord>(
                `${basePath}/invoices${editor ? `/${editor.id}` : ''}`,
                editor ? draft : { ...draft, requestKey: createKey },
                editor ? 'PUT' : 'POST',
              );
              setEditor(invoiceRecordSchema.parse(record));
              setCustomer(null);
              setDirty(false);
              setPreview(null);
              reload();
            } else await calculate();
          });
        }}
      >
        <nav className="form-outline" aria-label="Invoice sections">
          {[
            ['invoice-details', 'Customer & supply'],
            [
              'invoice-items',
              editor?.originalId ? 'Adjustment' : 'Items & pricing',
            ],
            ['invoice-notes', 'Notes & terms'],
            ['invoice-summary', 'Review & save'],
          ].map(([id, label], index) => (
            <button
              type="button"
              key={id}
              onClick={() => document.getElementById(id!)?.focus()}
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="invoice-builder-grid">
          <div className="invoice-main">
            <section
              id="invoice-details"
              tabIndex={-1}
              className="card invoice-section"
            >
              <div className="section-heading">
                <div>
                  <h2>
                    {editor?.documentType === 'credit_note'
                      ? 'Credit note'
                      : editor?.documentType === 'debit_note'
                        ? 'Debit note'
                        : 'Invoice details'}
                  </h2>
                  <p>
                    {editor?.number
                      ? 'This finalized document is immutable.'
                      : 'Drafts do not receive an official invoice number.'}
                  </p>
                </div>
                <Badge>
                  {editor?.status === 'cancelled'
                    ? 'Cancelled'
                    : editor?.status === 'finalized'
                      ? 'Finalized'
                      : 'Draft'}
                </Badge>
              </div>
              <fieldset disabled={readonly} className="invoice-fields">
                <div className="form-grid">
                  <label>
                    Issue date
                    <input
                      name="issueDate"
                      type="date"
                      required
                      max={today()}
                      defaultValue={editor?.draft.issueDate ?? today()}
                    />
                  </label>
                  <label>
                    Supply date
                    <input
                      name="supplyDate"
                      type="date"
                      required
                      max={today()}
                      min="2026-10-29"
                      defaultValue={editor?.draft.supplyDate ?? today()}
                    />
                  </label>
                </div>
                <div className="invoice-customer">
                  <div>
                    <small>BILL TO</small>
                    <h3>
                      {customer?.name ??
                        editor?.customerName ??
                        'Choose a customer'}
                    </h3>
                    <p>
                      {customer?.gstin ||
                        (customer
                          ? 'Unregistered recipient'
                          : editor
                            ? 'Saved customer'
                            : 'Use an active customer from your directory.')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!permissions.includes('customers.read')}
                    onClick={() => setPicker('customers')}
                  >
                    {customer || editor ? 'Change customer' : 'Choose customer'}
                  </button>
                </div>
                <FormError message={customerRegistrationError} />
                <AddressFields
                  key={customer?.id ?? editor?.id ?? 'address'}
                  address={
                    customer?.address ??
                    editor?.draft.deliveryAddress ??
                    blankAddress
                  }
                />
                <label>
                  Goods supply treatment
                  <select
                    name="goodsTreatment"
                    defaultValue={editor?.draft.goodsTreatment ?? 'movement'}
                  >
                    <option value="movement">
                      Goods move to delivery address
                    </option>
                    <option value="no_movement">
                      Goods stay at the specified address
                    </option>
                  </select>
                </label>
                <label className="check invoice-scope">
                  <input
                    type="checkbox"
                    name="ordinarySupplyConfirmed"
                    required
                    defaultChecked={
                      editor?.draft.ordinarySupplyConfirmed ?? false
                    }
                  />
                  I confirm ordinary domestic forward-charge supplies, unrelated
                  parties, sole monetary consideration and independent items.
                  Services follow the general rule, with no special rules or
                  e-commerce supplies.
                </label>
              </fieldset>
            </section>
            {!editor?.originalId ? (
              <section
                id="invoice-items"
                tabIndex={-1}
                className="card invoice-section"
              >
                <div className="section-heading">
                  <div>
                    <h2>Items</h2>
                    <p>Uses catalog prices and reviewed tax classifications.</p>
                  </div>
                  {!readonly && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={
                        lines.length >= 100 ||
                        !permissions.includes('catalog.read')
                      }
                      onClick={() => setPicker('catalog')}
                    >
                      <Icon name="plus" size={15} />
                      Add item
                    </button>
                  )}
                </div>
                {lines.length === 0 ? (
                  <div className="invoice-items-empty">
                    <Icon name="roles" size={28} />
                    <h3>Add your products or services</h3>
                    <p>Select an item to set its quantity and discount.</p>
                  </div>
                ) : (
                  <div className="invoice-lines">
                    {lines.map((line, index) => (
                      <fieldset
                        key={line.id}
                        disabled={readonly}
                        className="invoice-line"
                      >
                        <div className="invoice-line-title">
                          <strong>
                            {index + 1}.{' '}
                            {itemNames[line.id] ??
                              preview?.print.lines.find((l) => l.id === line.id)
                                ?.description ??
                              `Catalog item ${line.catalogItemId.slice(0, 8)}`}
                          </strong>
                          {!readonly && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Remove item ${index + 1}`}
                              onClick={() => {
                                setLines((old) =>
                                  old.filter((l) => l.id !== line.id),
                                );
                                changed();
                              }}
                            >
                              <Icon name="close" size={16} />
                            </button>
                          )}
                        </div>
                        <div className="invoice-line-controls">
                          <label>
                            Quantity
                            <input
                              aria-label={`Quantity ${index + 1}`}
                              inputMode="decimal"
                              required
                              value={line.quantity}
                              onChange={(e) =>
                                updateLine(index, { quantity: e.target.value })
                              }
                            />
                          </label>
                          <Discount
                            label={`Line ${index + 1} discount`}
                            value={line.discount}
                            onChange={(v) => updateLine(index, { discount: v })}
                          />
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={line.invoiceDiscountEligible}
                              onChange={(e) =>
                                updateLine(index, {
                                  invoiceDiscountEligible: e.target.checked,
                                })
                              }
                            />
                            Invoice discount eligible
                          </label>
                        </div>
                        {permissions.includes('price.override') && (
                          <details>
                            <summary>Price override</summary>
                            <div className="form-grid">
                              <label>
                                Override unit price (INR)
                                <input
                                  inputMode="decimal"
                                  value={line.priceOverride?.unitPrice ?? ''}
                                  onChange={(e) =>
                                    updateLine(index, {
                                      priceOverride: e.target.value
                                        ? {
                                            unitPrice: e.target.value,
                                            reason:
                                              line.priceOverride?.reason ?? '',
                                          }
                                        : undefined,
                                    })
                                  }
                                />
                              </label>
                              {line.priceOverride && (
                                <label>
                                  Price override reason
                                  <input
                                    required
                                    minLength={5}
                                    maxLength={300}
                                    value={line.priceOverride.reason}
                                    onChange={(e) =>
                                      updateLine(index, {
                                        priceOverride: {
                                          ...line.priceOverride!,
                                          reason: e.target.value,
                                        },
                                      })
                                    }
                                  />
                                </label>
                              )}
                            </div>
                          </details>
                        )}
                        <TaxOverrides
                          line={line}
                          permissions={permissions}
                          onChange={(value) => updateLine(index, value)}
                        />
                      </fieldset>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <section
                id="invoice-items"
                tabIndex={-1}
                className="card invoice-section"
              >
                <div className="section-heading">
                  <div>
                    <h2>Value adjustment</h2>
                    <p>
                      Uses the original invoice classification. Physical
                      quantities and new discounts are not changed.
                    </p>
                  </div>
                </div>
                <div className="invoice-fields">
                  <p>
                    <strong>Reason:</strong> {editor.correctionReason}
                  </p>
                  {editor.correction?.lines.map((line) => (
                    <p key={line.lineId}>
                      {editor.lineDescriptions[line.lineId]}:{' '}
                      <strong>{formatPrice(line.supplyValue)}</strong> before
                      tax
                    </p>
                  ))}
                </div>
              </section>
            )}
            <section
              id="invoice-notes"
              tabIndex={-1}
              className="card invoice-section"
            >
              <div className="section-heading">
                <div>
                  <h2>Notes & terms</h2>
                  <p>Included in the saved document and print layout.</p>
                </div>
              </div>
              <fieldset disabled={readonly} className="invoice-fields">
                <label>
                  Notes
                  <textarea
                    aria-label="Notes"
                    name="notes"
                    maxLength={1000}
                    defaultValue={editor?.draft.notes ?? ''}
                  />
                </label>
                <label>
                  Terms
                  <textarea
                    aria-label="Terms"
                    name="terms"
                    maxLength={2000}
                    defaultValue={editor?.draft.terms ?? ''}
                  />
                </label>
              </fieldset>
            </section>
          </div>
          <aside className="invoice-sidebar">
            <section
              id="invoice-summary"
              tabIndex={-1}
              className="card invoice-section"
            >
              <div className="section-heading">
                <div>
                  <h2>Summary</h2>
                  <p>All amounts in INR</p>
                </div>
              </div>
              {!editor?.originalId && (
                <fieldset className="invoice-fields" disabled={readonly}>
                  <Discount
                    label="Invoice discount"
                    value={discount}
                    onChange={(v) => {
                      setDiscount(v);
                      changed();
                    }}
                  />
                  <small>Allocated across eligible values before tax.</small>
                </fieldset>
              )}
              {preview || recordPrint ? (
                <div className="invoice-totals" aria-live="polite">
                  {Object.entries({
                    'Supply value': (preview?.print ?? recordPrint)!.totals
                      .supplyValue,
                    CGST: (preview?.print ?? recordPrint)!.totals.cgst,
                    SGST: (preview?.print ?? recordPrint)!.totals.sgst,
                    UTGST: (preview?.print ?? recordPrint)!.totals.utgst,
                    IGST: (preview?.print ?? recordPrint)!.totals.igst,
                    'Grand total': (preview?.print ?? recordPrint)!.totals
                      .total,
                  }).map(([key, value]) => (
                    <div
                      key={key}
                      className={
                        key === 'Grand total' ? 'invoice-grand-total' : ''
                      }
                    >
                      <span>{key}</span>
                      <strong>{formatPrice(value)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="invoice-padding">
                  Calculate to review discounts, GST and the total.
                </p>
              )}
              <div className="invoice-actions">
                {(!editor || editor.status === 'draft') && (
                  <>
                    <button
                      className="button button-secondary"
                      value="calculate"
                      disabled={
                        busy ||
                        (readOnly && !editor) ||
                        (!readonly && lines.length === 0)
                      }
                    >
                      Calculate & preview
                    </button>
                    {!readonly && (
                      <button
                        className="button button-primary"
                        value="save"
                        disabled={busy || lines.length === 0}
                      >
                        Save draft
                      </button>
                    )}
                    {editor &&
                      !readOnly &&
                      permissions.includes('invoices.finalize') && (
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={
                            busy ||
                            dirty ||
                            !preview ||
                            preview.issuanceBlockers.length > 0
                          }
                          onClick={() =>
                            void run(async () => {
                              if (
                                !preview ||
                                !window.confirm(
                                  'Finalize this document? Issued records cannot be edited.',
                                )
                              )
                                return;
                              open(
                                await mutate<InvoiceRecord>(
                                  `${basePath}/invoices/${editor.id}/finalize`,
                                  {
                                    version: editor.version,
                                    requestKey: finalizeKey,
                                    previewDigest: preview.digest,
                                  },
                                ),
                              );
                              reload();
                            })
                          }
                        >
                          Finalize{' '}
                          {editor.documentType === 'credit_note'
                            ? 'credit note'
                            : editor.documentType === 'debit_note'
                              ? 'debit note'
                              : 'invoice'}
                        </button>
                      )}
                  </>
                )}
                {editor?.status === 'finalized' &&
                  editor.documentType === 'invoice' &&
                  !readOnly &&
                  permissions.includes('invoices.correct') && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const reason = window.prompt(
                            'Reason for a full credit reversal (at least 5 characters):',
                          );
                          if (!reason) return;
                          open(
                            await mutate<InvoiceRecord>(
                              `${basePath}/invoices/${editor.id}/full-credit`,
                              {
                                requestKey: crypto.randomUUID(),
                                issueDate: today(),
                                reason,
                              },
                            ),
                          );
                          reload();
                        })
                      }
                    >
                      Create full credit reversal
                    </button>
                  )}
                {(!editor || editor.status === 'draft') && !preview && (
                  <p className="invoice-gate">
                    Save the draft and calculate a fresh preview to check
                    whether this document is ready to finalize.
                  </p>
                )}
                {preview?.issuanceBlockers.map((message) => (
                  <p className="invoice-gate" key={message}>
                    {message}
                  </p>
                ))}
                {editor?.status === 'finalized' &&
                  editor.documentType === 'invoice' &&
                  !readOnly &&
                  permissions.includes('invoices.correct') && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        onClearError();
                        setDocumentAction('correction');
                      }}
                    >
                      Create credit / debit note
                    </button>
                  )}
                {editor?.status === 'draft' &&
                  editor.correction &&
                  !readOnly &&
                  permissions.includes('invoices.correct') && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        onClearError();
                        setDocumentAction('correction');
                      }}
                    >
                      Edit correction draft
                    </button>
                  )}
                {editor &&
                  editor.status !== 'cancelled' &&
                  !readOnly &&
                  permissions.includes('invoices.cancel') && (
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => {
                        onClearError();
                        setDocumentAction('cancel');
                      }}
                    >
                      {editor.number ? 'Cancel document' : 'Discard draft'}
                    </button>
                  )}
                {editor?.cancellation && (
                  <p role="status" className="invoice-gate">
                    Cancelled: {editor.cancellation.reason}. The original record
                    is retained.
                  </p>
                )}
                {dirty && <small>Unsaved changes</small>}
              </div>
            </section>
          </aside>
        </div>
      </form>
      {(preview?.print ?? recordPrint) && (
        <PrintPreview data={(preview?.print ?? recordPrint)!} />
      )}
      {editor && documentAction === 'correction' && (
        <CorrectionDialog
          record={editor}
          basePath={basePath}
          busy={busy}
          error={error}
          mutate={mutate}
          run={run}
          onClose={() => setDocumentAction(null)}
          onSaved={(record) => {
            open(record);
            setDocumentAction(null);
            reload();
          }}
        />
      )}
      {editor && documentAction === 'cancel' && (
        <CancellationDialog
          record={editor}
          basePath={basePath}
          busy={busy}
          error={error}
          mutate={mutate}
          run={run}
          onClose={() => setDocumentAction(null)}
          onSaved={(record) => {
            open(record);
            setDocumentAction(null);
            reload();
          }}
        />
      )}
      {picker && (
        <Picker
          kind={picker}
          basePath={basePath}
          onClose={() => setPicker(null)}
          onCustomer={(value) => {
            setCustomer(value);
            changed();
          }}
          onItem={(item) => {
            const id = crypto.randomUUID();
            setLines((old) => [
              ...old,
              {
                id,
                catalogItemId: item.id,
                quantity: '1',
                discount: { kind: 'none' },
                invoiceDiscountEligible: true,
              },
            ]);
            setItemNames((old) => ({ ...old, [id]: item.name }));
            changed();
          }}
        />
      )}
    </div>
  );
}
