import { useEffect, useState } from 'react';
import { Notification } from '@gst/ui/notifications';
import { invoicePageSchema } from '@gst/contracts';
import type {
  InvoiceSummary,
  OrganizationAccess,
  SessionInfo,
} from '@gst/contracts';
import { Badge, EmptyState, Icon } from './ui.js';
import { securityRequest } from './security-api.js';
import { canOpenView, viewInfo } from './workspace-navigation.js';
import type { View } from './workspace-navigation.js';
import { WorkspaceSetup } from './WorkspaceSetup.js';

export function WorkspaceHome({
  context,
  info,
  navigate,
}: {
  context: OrganizationAccess;
  info: SessionInfo;
  navigate: (view: View) => void;
}) {
  const [records, setRecords] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const canRead = context.access.permissions.includes('invoices.read');
  useEffect(() => {
    let active = true;
    setRecords([]);
    setError('');
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void securityRequest(
      '/organizations/' + context.organization.id + '/invoices?offset=0',
      undefined,
    )
      .then((data) => {
        const page = invoicePageSchema.parse(data);
        if (active) setRecords(page.items.slice(0, 5));
      })
      .catch(() => {
        if (active) setError('Recent documents could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [context.organization.id, canRead, attempt]);
  const shortcuts = (['invoices', 'customers', 'catalog'] as View[]).filter(
    (view) => canOpenView(view, context.access.permissions),
  );
  return (
    <div className="overview-workspace">
      <p className="overview-intro">
        Welcome back, <strong>{info.user.name.trim().split(/\s+/)[0]}</strong>.
        Pick up your billing work from here.
      </p>
      {shortcuts.length > 0 && (
        <nav className="quick-work" aria-label="Billing shortcuts">
          {shortcuts.map((view) => (
            <a
              key={view}
              href={'#/' + view}
              onClick={(event) => {
                event.preventDefault();
                navigate(view);
              }}
            >
              <Icon name={viewInfo[view].icon} size={20} />
              <span>
                {view === 'invoices'
                  ? 'Open invoices'
                  : view === 'customers'
                    ? 'Manage customers'
                    : 'Manage catalog'}
              </span>
              <Icon name="arrow" size={16} />
            </a>
          ))}
        </nav>
      )}
      {canRead ? (
        <section className="surface recent-documents">
          <div className="section-heading">
            <div>
              <h2>Recent documents</h2>
              <p>Up to five documents, ordered by issue date.</p>
            </div>
            <a
              href="#/invoices"
              className="button button-secondary"
              onClick={(event) => {
                event.preventDefault();
                navigate('invoices');
              }}
            >
              View all invoices
              <Icon name="arrow" size={16} />
            </a>
          </div>
          {loading ? (
            <p className="directory-loading" role="status">
              Loading recent documents...
            </p>
          ) : error ? (
            <div className="recent-error">
              <Notification message={error} />
              <button
                className="button button-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : records.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Customer</th>
                    <th>Issue date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <strong>
                          {record.number ??
                            (record.documentType === 'credit_note'
                              ? 'Credit note draft'
                              : record.documentType === 'debit_note'
                                ? 'Debit note draft'
                                : 'Invoice draft')}
                        </strong>
                      </td>
                      <td>{record.customerName}</td>
                      <td>{record.issueDate}</td>
                      <td>
                        <Badge
                          tone={
                            record.status === 'finalized'
                              ? 'green'
                              : record.status === 'cancelled'
                                ? 'neutral'
                                : 'amber'
                          }
                        >
                          {record.status === 'draft'
                            ? 'Draft'
                            : record.status === 'finalized'
                              ? 'Finalized'
                              : 'Cancelled'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="invoice" title="Ready for your first document">
              <span>
                Start in Invoices. Your saved drafts and issued documents will
                appear here.
              </span>
            </EmptyState>
          )}
        </section>
      ) : (
        <section className="surface">
          <EmptyState icon="home" title="Your workspace is ready">
            Use the navigation to open the records and settings available to
            your account.
          </EmptyState>
        </section>
      )}
      <WorkspaceSetup context={context} info={info} navigate={navigate} />
      <p className="overview-settings-note">
        <Icon name="settings" size={16} />
        Business details and team access are in Business settings. Personal
        security is in your account menu.
      </p>
    </div>
  );
}
