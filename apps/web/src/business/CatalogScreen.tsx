import { PageActions, useUnsavedChanges } from '../PageActions.js';
import { validationMessage } from '../validation-message.js';
import { useState } from 'react';
import {
  catalogInputSchema,
  catalogPageSchema,
  catalogViewSchema,
  taxHistorySchema,
  taxReviewSchema,
  unitOptions,
} from '@gst/contracts';
import type { CatalogView, TaxRevisionView } from '@gst/contracts';
import { securityRequest } from '../security-api.js';
import { formText, formValues } from '../security-forms.js';
import { Badge, EmptyState, Icon, formatDate } from '../ui.js';
import {
  DirectoryPagination,
  RecordPage,
  RecordLoading,
  useRecordPage,
  DirectoryTools,
  FormError,
  SelectField,
  formatPrice,
  useDirectory,
} from './shared.js';
import type { BusinessScreenProps } from './shared.js';
export function CatalogScreen({
  recordId,
  onRecordNavigate,
  readOnly = false,
  basePath,
  permissions,
  busy,
  error,
  run,
  mutate,
  onClearError,
}: BusinessScreenProps) {
  const canRead = permissions.includes('catalog.read');
  const canManage = !readOnly && permissions.includes('catalog.manage');
  const canReview = !readOnly && permissions.includes('catalog.tax.verify');
  const list = useDirectory<CatalogView>(
    `${basePath}/catalog`,
    catalogPageSchema,
    canRead && !recordId,
  );
  const [editing, setEditing] = useState<CatalogView | null | undefined>();
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<TaxRevisionView[] | null>(null);
  useUnsavedChanges(dirty);
  const open = (item: CatalogView | null) => {
    onRecordNavigate?.(item?.id ?? 'new');
  };
  const close = () => onRecordNavigate?.();
  const detail = useRecordPage(
    `${basePath}/catalog`,
    recordId,
    catalogViewSchema,
    (record) => {
      setEditing(record);
      setDirty(false);
      setFormError('');
      onClearError();
      setHistory(null);
    },
  );
  if (recordId && (detail.loading || detail.error))
    return <RecordLoading {...detail} onBack={close} onRetry={detail.retry} />;
  return (
    <>
      {!recordId && (
        <section className="surface directory business-directory">
          <PageActions>
            {canManage && (
              <button
                className="button button-primary"
                onClick={() => open(null)}
              >
                <Icon name="plus" size={17} />
                Add item
              </button>
            )}
          </PageActions>
          {canRead ? (
            <>
              <DirectoryTools
                noun="catalog"
                query={list.query}
                status={list.status}
                onSearch={list.search}
                onStatus={list.filter}
                onRefresh={list.reload}
                loading={list.loading}
              />
              <FormError message={list.loadError} />
              {list.loading ? (
                <p className="directory-loading" role="status">
                  Loading catalog…
                </p>
              ) : list.loadError ? null : list.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price / GST</th>
                        <th>Classification</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="person">
                              <span className="feature-icon">
                                <Icon
                                  name={
                                    item.kind === 'service' ? 'key' : 'roles'
                                  }
                                  size={19}
                                />
                              </span>
                              <div>
                                <strong>{item.name}</strong>
                                <small>
                                  {item.code} ·{' '}
                                  {item.kind === 'service'
                                    ? 'Service'
                                    : 'Product'}{' '}
                                  · {item.unitCode}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <strong className="table-detail">
                              {formatPrice(item.price)}
                            </strong>
                            <small className="table-subdetail">
                              {item.priceIncludesGst
                                ? 'GST included'
                                : 'GST excluded'}{' '}
                              · {item.tax.gstPercent}%
                            </small>
                          </td>
                          <td>
                            <div className="badge-wrap">
                              <Badge
                                tone={item.tax.verifiedAt ? 'green' : 'amber'}
                              >
                                {item.tax.verifiedAt
                                  ? 'Reviewed'
                                  : 'Needs review'}
                              </Badge>
                              {item.archivedAt && <Badge>Archived</Badge>}
                            </div>
                            <small className="table-subdetail">
                              {item.tax.hsnSac} · from {item.tax.effectiveFrom}
                            </small>
                          </td>
                          <td>
                            <button
                              className="button button-secondary button-small"
                              onClick={() => open(item)}
                            >
                              {canManage && !item.archivedAt
                                ? 'Edit item'
                                : 'View item'}
                              <Icon name="chevron" size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon="roles"
                  title={
                    list.query || list.status !== 'active'
                      ? 'No matching items'
                      : 'Build your catalog'
                  }
                >
                  Add your products and services with prices and units.
                </EmptyState>
              )}
              <DirectoryPagination
                offset={list.offset}
                count={list.items.length}
                hasMore={list.hasMore}
                loading={list.loading}
                onChange={list.setOffset}
              />
            </>
          ) : (
            <EmptyState icon="lock" title="Catalog access is restricted">
              You can create items with your current access.
            </EmptyState>
          )}
        </section>
      )}
      {!recordId && (
        <div className="info-note">
          <Icon name="info" size={18} />
          <p>
            Review HSN/SAC classifications and GST rates against the current
            notification before using them for billing.
          </p>
        </div>
      )}
      {editing !== undefined && (
        <RecordPage
          title={
            editing
              ? `${canManage && !editing.archivedAt ? 'Edit' : 'View'} item`
              : 'Add catalog item'
          }
          description={
            editing
              ? `${editing.code} · revision ${editing.tax.revision}`
              : 'Create a product or service with clear pricing.'
          }
          onClose={close}
          busy={busy}
        >
          <FormError
            message={formError || error}
            onDismiss={() => setFormError('')}
          />
          <form
            key={editing?.version ?? 0}
            onChange={() => setDirty(true)}
            onSubmit={(event) => {
              const data = formValues(event);
              const fields = Object.fromEntries(
                [
                  'code',
                  'name',
                  'description',
                  'kind',
                  'unitCode',
                  'price',
                ].map((key) => [key, formText(data, key)]),
              );
              const parsed = catalogInputSchema.safeParse({
                ...fields,
                version: editing?.version ?? 0,
                priceIncludesGst: data.has('priceIncludesGst'),
                tax: Object.fromEntries(
                  ['hsnSac', 'category', 'gstPercent', 'effectiveFrom'].map(
                    (key) => [key, formText(data, key)],
                  ),
                ),
              });
              if (!parsed.success) {
                setFormError(validationMessage(parsed.error));
                return;
              }
              setFormError('');
              void run(async () => {
                await mutate(
                  `${basePath}/catalog${editing ? `/${editing.id}` : ''}`,
                  parsed.data,
                  editing ? 'PUT' : 'POST',
                );
                list.reload();
                setDirty(false);
                onRecordNavigate?.(undefined, true);
              });
            }}
          >
            <fieldset
              className="form-section"
              disabled={busy || !canManage || Boolean(editing?.archivedAt)}
            >
              <legend>Item details</legend>
              <div className="form-grid">
                <label>
                  Item name
                  <input
                    name="name"
                    required
                    maxLength={200}
                    defaultValue={editing?.name}
                  />
                </label>
                <label>
                  Item code
                  <input
                    name="code"
                    required
                    maxLength={40}
                    defaultValue={editing?.code}
                    placeholder="e.g. PROD-001"
                  />
                </label>
                <SelectField
                  label="Item type"
                  name="kind"
                  value={editing?.kind ?? 'goods'}
                >
                  <option value="goods">Product / goods</option>
                  <option value="service">Service</option>
                </SelectField>
                <SelectField
                  label="Unit"
                  name="unitCode"
                  value={editing?.unitCode ?? 'NOS'}
                >
                  {unitOptions.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.name} ({unit.code}) · {unit.precision} decimal
                      places
                    </option>
                  ))}
                </SelectField>
                <label>
                  Unit price (INR)
                  <input
                    name="price"
                    inputMode="decimal"
                    required
                    maxLength={19}
                    defaultValue={editing?.price ?? '0.0000'}
                  />
                </label>
                <label className="check price-tax-toggle">
                  <input
                    name="priceIncludesGst"
                    type="checkbox"
                    defaultChecked={editing?.priceIncludesGst}
                  />
                  <span>
                    Price includes GST
                    <small>Leave off for GST-exclusive pricing.</small>
                  </span>
                </label>
              </div>
              <label>
                Description
                <textarea
                  name="description"
                  maxLength={1000}
                  rows={2}
                  defaultValue={editing?.description}
                />
              </label>
              <fieldset className="tax-fields">
                <legend>Tax classification</legend>
                <div className="form-grid">
                  <label>
                    HSN / SAC
                    <input
                      name="hsnSac"
                      required
                      inputMode="numeric"
                      maxLength={8}
                      defaultValue={editing?.tax.hsnSac}
                    />
                  </label>
                  <SelectField
                    label="Tax category"
                    name="category"
                    value={editing?.tax.category ?? 'taxable'}
                  >
                    <option value="taxable">Taxable</option>
                    <option value="nil">Nil-rated</option>
                    <option value="exempt">Exempt</option>
                  </SelectField>
                  <label>
                    GST rate (%)
                    <input
                      name="gstPercent"
                      inputMode="decimal"
                      required
                      maxLength={6}
                      defaultValue={editing?.tax.gstPercent ?? ''}
                    />
                  </label>
                  <label>
                    Effective from
                    <input
                      name="effectiveFrom"
                      type="date"
                      required
                      min="1900-01-01"
                      max="9999-12-31"
                      defaultValue={
                        editing?.tax.effectiveFrom ??
                        new Date().toLocaleDateString('en-CA')
                      }
                    />
                  </label>
                </div>
                <small>
                  Use an HSN for goods or a six-digit SAC starting with 99 for
                  services. Taxable items require a positive rate; nil/exempt
                  items use zero.
                </small>
              </fieldset>
            </fieldset>
            <div className="dialog-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={close}
              >
                Close
              </button>
              {canManage && !editing?.archivedAt && (
                <button className="button button-primary" disabled={busy}>
                  {editing ? 'Save item' : 'Create item'}
                </button>
              )}
            </div>
          </form>
          {editing && (
            <section className="tax-review-section">
              <div className="section-heading">
                <div>
                  <h3>Classification review</h3>
                  <p>
                    {editing.tax.verifiedAt
                      ? `Reviewed ${formatDate(editing.tax.verifiedAt)}`
                      : 'The saved classification has not been reviewed.'}
                  </p>
                </div>
                <Badge tone={editing.tax.verifiedAt ? 'green' : 'amber'}>
                  {editing.tax.verifiedAt ? 'Reviewed' : 'Needs review'}
                </Badge>
              </div>
              {editing.tax.reference && (
                <p className="review-reference">{editing.tax.reference}</p>
              )}
              {canReview && !editing.tax.verifiedAt && !editing.archivedAt && (
                <form
                  onSubmit={(event) => {
                    const data = formValues(event);
                    const parsed = taxReviewSchema.safeParse({
                      version: editing.version,
                      reference: formText(data, 'reference'),
                    });
                    if (!parsed.success) {
                      setFormError(validationMessage(parsed.error));
                      return;
                    }
                    void run(async () => {
                      const next = catalogViewSchema.parse(
                        await mutate(
                          `${basePath}/catalog/${editing.id}/tax-review`,
                          parsed.data,
                        ),
                      );
                      setEditing(next);
                      setDirty(false);
                      setHistory(null);
                      list.reload();
                    });
                  }}
                >
                  <p>
                    Review the saved HSN/SAC, rate, category and effective date
                    against your current source. Save any edits first.
                  </p>
                  <label>
                    Review reference
                    <input
                      name="reference"
                      required
                      minLength={5}
                      maxLength={300}
                      placeholder="Notification or classification source checked"
                    />
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={busy || dirty}
                  >
                    Confirm classification review
                  </button>
                  {dirty && (
                    <small>
                      Save your changes before reviewing this classification.
                    </small>
                  )}
                </form>
              )}
              {canRead && (
                <button
                  className="button button-quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setHistory(
                        taxHistorySchema.parse(
                          await securityRequest(
                            `${basePath}/catalog/${editing.id}/tax-history`,
                            undefined,
                          ),
                        ),
                      ),
                    )
                  }
                >
                  View classification history
                  <Icon name="chevron" size={14} />
                </button>
              )}
              {history && (
                <ol className="tax-history">
                  {history.map((tax) => (
                    <li key={tax.id}>
                      <strong>
                        Revision {tax.revision} · {tax.hsnSac} ·{' '}
                        {tax.gstPercent}%
                      </strong>
                      <p>
                        {tax.category} · effective {tax.effectiveFrom} ·{' '}
                        {tax.verifiedAt ? 'Reviewed' : 'Unreviewed'}
                      </p>
                      {tax.reference && <small>{tax.reference}</small>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
          {canManage && editing && (
            <div className="danger-zone">
              <h3>
                {editing.archivedAt ? 'Restore this item' : 'Archive this item'}
              </h3>
              <p>
                Keep its details and classification history for future
                reference.
              </p>
              <button
                className={`button ${editing.archivedAt ? 'button-secondary' : 'button-danger'}`}
                disabled={busy}
                onClick={() => {
                  if (
                    editing.archivedAt ||
                    window.confirm(
                      'Archive this item? Its details and tax history will be preserved.',
                    )
                  )
                    void run(async () => {
                      await mutate(
                        `${basePath}/catalog/${editing.id}/archive`,
                        {
                          version: editing.version,
                          archived: !editing.archivedAt,
                        },
                        'PUT',
                      );
                      list.reload();
                      setDirty(false);
                      onRecordNavigate?.(undefined, true);
                    });
                }}
              >
                {editing.archivedAt ? 'Restore item' : 'Archive item'}
              </button>
            </div>
          )}
        </RecordPage>
      )}
    </>
  );
}
