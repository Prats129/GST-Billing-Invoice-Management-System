import { useContext, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { indianStates } from '@gst/contracts';
import type { Address, DirectoryPage, Permission } from '@gst/contracts';
import type { Mutate, RunAction } from '../security-forms.js';
import { formText } from '../security-forms.js';
import { securityRequest } from '../security-api.js';
import { Icon } from '../ui.js';
import {
  ErrorRecoveryActions,
  ErrorRecoveryContext,
} from '../ErrorRecovery.js';
import { Notification } from '@gst/ui/notifications';
export interface BusinessScreenProps {
  recordId?: string | undefined;
  onRecordNavigate?: (id?: string, replace?: boolean) => void;
  readOnly?: boolean;
  basePath: string;
  permissions: Permission[];
  busy: boolean;
  error: string;
  run: RunAction;
  mutate: Mutate;
  onClearError: () => void;
}
export function SelectField({
  label,
  name,
  value,
  children,
  required = false,
  onChange,
}: {
  label: string;
  name: string;
  value?: string;
  children: ReactNode;
  required?: boolean;
  onChange?: () => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        required={required}
        onChange={onChange}
      >
        {children}
      </select>
    </div>
  );
}
export function AddressFields({ address }: { address?: Address }) {
  return (
    <fieldset className="address-fields">
      <legend>Indian address</legend>
      <label>
        Address line 1
        <input
          name="line1"
          required
          maxLength={200}
          defaultValue={address?.line1}
          autoComplete="address-line1"
        />
      </label>
      <label>
        Address line 2
        <input
          name="line2"
          maxLength={200}
          defaultValue={address?.line2}
          autoComplete="address-line2"
        />
      </label>
      <div className="form-grid">
        <label>
          City
          <input
            name="city"
            required
            maxLength={100}
            defaultValue={address?.city}
            autoComplete="address-level2"
          />
        </label>
        <SelectField
          label="State / territory"
          name="stateCode"
          value={address?.stateCode ?? ''}
          required
        >
          <option value="" disabled>
            Choose state
          </option>
          {indianStates.map(([code, name]) => (
            <option key={code} value={code}>
              {code} · {name}
            </option>
          ))}
        </SelectField>
        <label>
          PIN code
          <input
            name="postalCode"
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{5}"
            minLength={6}
            maxLength={6}
            defaultValue={address?.postalCode}
            autoComplete="postal-code"
          />
        </label>
      </div>
    </fieldset>
  );
}
export const readAddress = (data: FormData) =>
  Object.fromEntries(
    ['line1', 'line2', 'city', 'stateCode', 'postalCode'].map((key) => [
      key,
      formText(data, key),
    ]),
  );
export function formatPrice(value: string) {
  const [whole = '0', fraction = '0000'] = value.split('.');
  return `₹${BigInt(whole).toLocaleString('en-IN')}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}
export function useDirectory<T>(
  path: string,
  schema: { parse: (data: unknown) => DirectoryPage<T> },
  enabled: boolean,
) {
  const [page, setPage] = useState<DirectoryPage<T>>({
    items: [],
    hasMore: false,
  });
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    const search = new URLSearchParams({
      q: query,
      status,
      offset: String(offset),
    });
    void securityRequest(`${path}?${search}`, undefined)
      .then((data) => {
        if (active) setPage(schema.parse(data));
      })
      .catch(() => {
        if (active) {
          setPage({ items: [], hasMore: false });
          setLoadError(
            'Could not load these records. Refresh the list or your workspace access.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, schema, enabled, query, status, offset, attempt]);
  return {
    ...page,
    loading,
    loadError,
    query,
    status,
    offset,
    search: (value: string) => {
      setQuery(value);
      setOffset(0);
    },
    filter: (value: string) => {
      setStatus(value);
      setOffset(0);
    },
    setOffset,
    reload: () => setAttempt((value) => value + 1),
  };
}
export function DirectoryTools({
  noun,
  query,
  status,
  onSearch,
  onStatus,
  onRefresh,
  loading,
}: {
  noun: string;
  query: string;
  status: string;
  onSearch: (value: string) => void;
  onStatus: (value: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const id = useId();
  return (
    <div className="directory-tools">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(formText(new FormData(event.currentTarget), 'query'));
        }}
      >
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            name="query"
            aria-label={`Search ${noun}`}
            defaultValue={query}
            placeholder="Search name or code"
            maxLength={80}
          />
        </label>
        <button className="button button-secondary" disabled={loading}>
          Search
        </button>
      </form>
      <div className="directory-filters">
        <label className="sr-only" htmlFor={id}>
          Record status
        </label>
        <select
          id={id}
          value={status}
          onChange={(event) => onStatus(event.target.value)}
        >
          <option value="active">Active records</option>
          <option value="archived">Archived records</option>
          <option value="all">All records</option>
        </select>
        <button
          className="icon-button"
          aria-label={`Refresh ${noun}`}
          onClick={onRefresh}
          disabled={loading}
        >
          <Icon name="refresh" size={17} />
        </button>
      </div>
    </div>
  );
}
export function DirectoryPagination({
  offset,
  count,
  hasMore,
  loading,
  onChange,
}: {
  offset: number;
  count: number;
  hasMore: boolean;
  loading: boolean;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {count ? `${offset + 1}–${offset + count}` : '0'} records shown
        {hasMore &&
          offset >= 10000 &&
          ' · Narrow your search for more records.'}
      </span>
      <div>
        <button
          className="button button-quiet"
          disabled={offset === 0 || loading}
          onClick={() => onChange(Math.max(0, offset - 50))}
        >
          <Icon name="chevron" size={15} />
          Previous
        </button>
        <button
          className="button button-quiet"
          disabled={!hasMore || loading || offset >= 10000}
          onClick={() => onChange(offset + 50)}
        >
          Next
          <Icon name="chevron" size={15} />
        </button>
      </div>
    </div>
  );
}
export function FormError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  const recovery = useContext(ErrorRecoveryContext);
  // The shared notification host follows the active dialog, so workspace
  // errors remain reachable there without duplicating the same failure.
  if (recovery?.message === message) return null;
  return message ? (
    <Notification message={message} onDismiss={onDismiss}>
      {message}
      <ErrorRecoveryActions message={message} />
    </Notification>
  ) : null;
}

// Resolve detail URLs independently of directory pagination or filters.
export function useRecordPage<T>(
  endpoint: string,
  id: string | undefined,
  schema: { parse: (value: unknown) => T },
  onLoaded: (value: T | null | undefined) => void,
) {
  const [loading, setLoading] = useState(Boolean(id && id !== 'new'));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    onLoaded(undefined);
    if (!id || id === 'new') {
      onLoaded(id === 'new' ? null : undefined);
      setLoading(false);
      return;
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      setLoading(false);
      setError(
        'This record link is invalid. Return to the list and select a record.',
      );
      return;
    }
    setLoading(true);
    void securityRequest(`${endpoint}/${id}`, undefined)
      .then((data) => {
        if (active) onLoaded(schema.parse(data));
      })
      .catch(() => {
        if (active)
          setError(
            'This record could not be loaded. It may be unavailable or you may not have access.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Loading depends on the route, not the current editor callback identity.
  }, [endpoint, id, attempt]);
  return { loading, error, retry: () => setAttempt((value) => value + 1) };
}
export function RecordPage({
  title,
  description,
  onClose,
  busy,
  children,
}: {
  title: string;
  busy: boolean;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className="surface record-page">
      <header className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Back to list
        </button>
      </header>
      {children}
    </section>
  );
}
export function RecordLoading({
  loading,
  error,
  onBack,
  onRetry,
}: {
  loading: boolean;
  error: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <section className="surface record-page">
      <button className="button button-secondary" onClick={onBack}>
        Back to list
      </button>
      {loading ? (
        <p role="status">Loading record...</p>
      ) : (
        <>
          <Notification message={error} />
          <button className="button button-secondary" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </section>
  );
}
