import { useState } from 'react';
import { customerInputSchema, customerPageSchema } from '@gst/contracts';
import type { CustomerView } from '@gst/contracts';
import { formText, formValues } from '../security-forms.js';
import { Avatar, Badge, Dialog, EmptyState, Icon } from '../ui.js';
import {
  AddressFields,
  DirectoryPagination,
  DirectoryTools,
  FormError,
  readAddress,
  useDirectory,
} from './shared.js';
import type { BusinessScreenProps } from './shared.js';
export function CustomersScreen({
  basePath,
  permissions,
  busy,
  error,
  run,
  mutate,
  onClearError,
}: BusinessScreenProps) {
  const canRead = permissions.includes('customers.read');
  const canManage = permissions.includes('customers.manage');
  const list = useDirectory<CustomerView>(
    `${basePath}/customers`,
    customerPageSchema,
    canRead,
  );
  const [editing, setEditing] = useState<CustomerView | null | undefined>();
  const [formError, setFormError] = useState('');
  const open = (customer: CustomerView | null) => {
    onClearError();
    setFormError('');
    setEditing(customer);
  };
  const close = () => {
    setEditing(undefined);
    setFormError('');
    onClearError();
  };
  return (
    <>
      <section className="surface directory business-directory">
        <div className="section-heading">
          <div>
            <h2>Customer directory</h2>
            <p>Contact and billing details, ready when you need them.</p>
          </div>
          {canManage && (
            <button
              className="button button-primary"
              onClick={() => open(null)}
            >
              <Icon name="plus" size={17} />
              Add customer
            </button>
          )}
        </div>
        {canRead ? (
          <>
            <DirectoryTools
              noun="customers"
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
                Loading customers…
              </p>
            ) : list.loadError ? null : list.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>GSTIN / location</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((customer) => (
                      <tr key={customer.id}>
                        <td>
                          <div className="person">
                            <Avatar name={customer.name} />
                            <div>
                              <strong>{customer.name}</strong>
                              <small>
                                {customer.code} ·{' '}
                                {customer.email ||
                                  customer.phone ||
                                  'No contact added'}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong className="table-detail">
                            {customer.gstin || 'GSTIN not provided'}
                          </strong>
                          <small className="table-subdetail">
                            {customer.address.city} ·{' '}
                            {customer.address.postalCode}
                          </small>
                        </td>
                        <td>
                          <Badge
                            tone={customer.archivedAt ? 'neutral' : 'green'}
                          >
                            {customer.archivedAt ? 'Archived' : 'Active'}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="button button-secondary button-small"
                            onClick={() => open(customer)}
                          >
                            {canManage && !customer.archivedAt
                              ? 'Edit customer'
                              : 'View customer'}
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
                icon="users"
                title={
                  list.query || list.status !== 'active'
                    ? 'No matching customers'
                    : 'Meet your first customer'
                }
              >
                Add a customer to keep their details in one place.
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
          <EmptyState icon="lock" title="Customer directory is restricted">
            You can create customers with your current access.
          </EmptyState>
        )}
      </section>
      {editing !== undefined && (
        <Dialog
          title={
            editing
              ? `${canManage && !editing.archivedAt ? 'Edit' : 'View'} customer`
              : 'Add customer'
          }
          description={
            editing
              ? editing.code
              : 'Keep contact and address details together.'
          }
          onClose={close}
          busy={busy}
          wide
        >
          <FormError message={formError || error} />
          <form
            onSubmit={(event) => {
              const data = formValues(event);
              const fields = Object.fromEntries(
                ['code', 'name', 'email', 'phone', 'gstin', 'notes'].map(
                  (key) => [key, formText(data, key)],
                ),
              );
              const parsed = customerInputSchema.safeParse({
                ...fields,
                version: editing?.version ?? 0,
                address: readAddress(data),
              });
              if (!parsed.success) {
                setFormError(
                  parsed.error.issues[0]?.message ??
                    'Check the customer details.',
                );
                return;
              }
              setFormError('');
              void run(async () => {
                await mutate(
                  `${basePath}/customers${editing ? `/${editing.id}` : ''}`,
                  parsed.data,
                  editing ? 'PUT' : 'POST',
                );
                list.reload();
                close();
              });
            }}
          >
            <fieldset
              className="form-section"
              disabled={busy || !canManage || Boolean(editing?.archivedAt)}
            >
              <legend>Customer details</legend>
              <div className="form-grid">
                <label>
                  Customer name
                  <input
                    name="name"
                    required
                    maxLength={200}
                    defaultValue={editing?.name}
                  />
                </label>
                <label>
                  Customer code
                  <input
                    name="code"
                    required
                    maxLength={40}
                    defaultValue={editing?.code}
                    placeholder="e.g. CUST-001"
                  />
                </label>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    maxLength={254}
                    defaultValue={editing?.email}
                  />
                </label>
                <label>
                  Phone
                  <input
                    name="phone"
                    type="tel"
                    maxLength={25}
                    defaultValue={editing?.phone}
                  />
                </label>
                <label>
                  Customer GSTIN (optional)
                  <input
                    name="gstin"
                    maxLength={15}
                    defaultValue={editing?.gstin}
                  />
                </label>
              </div>
              <AddressFields
                {...(editing ? { address: editing.address } : {})}
              />
              <label>
                Notes
                <textarea
                  name="notes"
                  maxLength={1000}
                  rows={3}
                  defaultValue={editing?.notes}
                />
              </label>
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
                  {editing ? 'Save customer' : 'Create customer'}
                </button>
              )}
            </div>
          </form>
          {canManage && editing && (
            <div className="danger-zone">
              <h3>
                {editing.archivedAt
                  ? 'Restore this customer'
                  : 'Archive this customer'}
              </h3>
              <p>
                {editing.archivedAt
                  ? 'Make this customer available again.'
                  : 'Hide this customer from active lists while preserving their history.'}
              </p>
              <button
                className={`button ${editing.archivedAt ? 'button-secondary' : 'button-danger'}`}
                disabled={busy}
                onClick={() => {
                  if (
                    editing.archivedAt ||
                    window.confirm(
                      'Archive this customer? Their details and history will be preserved.',
                    )
                  )
                    void run(async () => {
                      await mutate(
                        `${basePath}/customers/${editing.id}/archive`,
                        {
                          version: editing.version,
                          archived: !editing.archivedAt,
                        },
                        'PUT',
                      );
                      list.reload();
                      close();
                    });
                }}
              >
                {editing.archivedAt ? 'Restore customer' : 'Archive customer'}
              </button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
