import type { Detail, Operation } from './types.js';
import { Field, Form, Table, OperationList } from './components.js';
import { LicensePanel } from './LicensePanel.js';
import { value, iso } from './forms.js';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { platformSession } from '@gst/contracts/platform';
import type {
  PlatformSession,
  PlatformOrganizationView,
} from '@gst/contracts/platform';
import { api, setCsrf, requestKey, paise, money, download } from './api.js';
export function App() {
  const [session, setSession] = useState<PlatformSession | null>(null),
    [starting, setStarting] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [route, setRoute] = useState(location.hash || '#/overview'),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [organizations, setOrganizations] = useState<PlatformOrganizationView[]>(
      [],
    ),
    [hasMore, setHasMore] = useState(false),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState({ q: '', edition: '', state: '' });
  const [overview, setOverview] = useState<Record<string, unknown>>({}),
    [operations, setOperations] = useState<Operation[]>([]),
    [sessions, setSessions] = useState<Record<string, unknown>[]>([]),
    [mfa, setMfa] = useState<{ secret: string; uri: string } | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [link, setLink] = useState('');
  const dirtyForms = useRef(new Set<string>());
  const busyRef = useRef(false);
  const dirty = useRef(false),
    lastRoute = useRef(route);
  const [section, id, tab = 'overview'] = route.replace(/^#\//, '').split('/');
  const refresh = () => setAttempt((v) => v + 1);
  async function loadSession() {
    const s = platformSession.parse(await api('auth/session'));
    setCsrf(s.csrfToken);
    setSession(s);
  }
  useEffect(() => {
    void loadSession()
      .catch(() => setSession(null))
      .finally(() => setStarting(false));
  }, []);
  useEffect(() => {
    const changed = () => {
      const next = location.hash || '#/overview';
      if (next === lastRoute.current) return;
      if (dirty.current && !confirm('Discard your unsaved changes?')) {
        history.replaceState(null, '', lastRoute.current);
        return;
      }
      dirty.current = false;
      dirtyForms.current.clear();
      lastRoute.current = next;
      setRoute(next);
      setError('');
      setMessage('');
      setLink('');
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const expired = () => {
      setSession(null);
      setCsrf('');
      setDetail(null);
      setError('Your session expired. Sign in again.');
      dirty.current = false;
      dirtyForms.current.clear();
    };
    addEventListener('platform-session-expired', expired);
    addEventListener('hashchange', changed);
    addEventListener('beforeunload', unload);
    return () => {
      removeEventListener('platform-session-expired', expired);
      removeEventListener('hashchange', changed);
      removeEventListener('beforeunload', unload);
    };
  }, []);
  async function run(action: () => Promise<unknown>) {
    if (busyRef.current) throw new Error('Wait for the current request.');
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      setMessage('Saved.');
      refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
      throw e;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  const save = (path: string, body: unknown, method = 'POST') =>
    run(() => api(path, body, method));
  useEffect(() => {
    if (!session?.mfaVerified) return;
    let active = true;
    setLoading(true);
    setError('');
    if (detail?.organization.id !== id) setDetail(null);
    const load = async () => {
      if (section === 'organizations' && id && id !== 'new') {
        if (!/^[a-f0-9-]{36}$/i.test(id))
          throw new Error('This organization link is invalid.');
        const d = await api<Detail>('organizations/' + id);
        if (active) setDetail(d);
      } else if (section === 'organizations' && id !== 'new') {
        const p = new URLSearchParams({ ...filter, offset: String(offset) });
        const d = await api<{
          items: PlatformOrganizationView[];
          hasMore: boolean;
        }>('organizations?' + p);
        if (active) {
          setOrganizations(d.items);
          setHasMore(d.hasMore);
        }
      } else if (section === 'operations') {
        const d = await api<Operation[]>('operations');
        if (active) setOperations(d);
      } else if (section === 'security') {
        const d = await api<Record<string, unknown>[]>('auth/sessions');
        if (active) setSessions(d);
      } else if (section === 'overview') {
        const d = await api<Record<string, unknown>>('overview');
        if (active) setOverview(d);
      }
    };
    void load()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route, attempt, session?.mfaVerified, offset, filter, section, id]);
  const mark = (v: boolean, source = 'default') => {
    if (v) dirtyForms.current.add(source);
    else dirtyForms.current.delete(source);
    dirty.current = dirtyForms.current.size > 0;
  };
  if (starting)
    return (
      <main className="auth">
        <p role="status">Opening Platform Admin…</p>
      </main>
    );
  if (!session)
    return (
      <main className="auth">
        <div className="auth-brand">
          GST Billing <span>Platform Admin</span>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Form
          title="Publisher sign in"
          submit="Sign in"
          busy={busy}
          dirty={mark}
          onSave={(d) =>
            run(async () => {
              const s = platformSession.parse(
                await api('auth/login', {
                  email: value(d, 'email'),
                  password: value(d, 'password'),
                }),
              );
              setCsrf(s.csrfToken);
              setSession(s);
            })
          }
        >
          <Field label="Email" name="email" type="email" />
          <Field label="Password" name="password" type="password" />
        </Form>
      </main>
    );
  if (!session.mfaVerified)
    return (
      <main className="auth">
        <h1>Secure your platform account</h1>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!session.mfaEnabled && !mfa && (
          <button
            onClick={() =>
              void run(async () =>
                setMfa(await api('auth/mfa/setup', {})),
              ).catch(() => {})
            }
          >
            Set up authenticator
          </button>
        )}
        {mfa && (
          <section className="card">
            <p>Add this secret to your authenticator app. Keep it private.</p>
            <code>{mfa.secret}</code>
            <a href={mfa.uri}>Open authenticator</a>
          </section>
        )}
        <Form
          title={
            session.mfaEnabled
              ? 'Two-step verification'
              : 'Confirm authenticator'
          }
          submit="Verify"
          busy={busy}
          dirty={mark}
          onSave={(d) =>
            run(async () => {
              const r = await api<{ recoveryCodes: string[] }>(
                'auth/mfa/' + (session.mfaEnabled ? 'verify' : 'enroll'),
                { code: value(d, 'code') },
              );
              setCodes(r.recoveryCodes);
              setMfa(null);
              await loadSession();
            })
          }
        >
          <Field label="Verification or recovery code" name="code" />
        </Form>
      </main>
    );
  const org = detail?.organization,
    base = 'organizations/' + id;
  return (
    <div className="layout">
      <aside>
        <div className="brand">
          GST Billing<small>Publisher control room</small>
        </div>
        <nav aria-label="Platform navigation">
          <a href="#/overview">Overview</a>
          <a href="#/organizations">Organizations</a>
          <a href="#/operations">Operations</a>
          <a href="#/security">Account security</a>
        </nav>
        <div className="owner">
          <strong>{session.user.name}</strong>
          <small>{session.user.email}</small>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api('auth/logout', {});
                setSession(null);
                setCsrf('');
              }).catch(() => {})
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <small>PLATFORM ADMINISTRATION</small>
            <h1>
              {org?.name ??
                (id === 'new'
                  ? 'Register organization'
                  : section === 'security'
                    ? 'Account security'
                    : section === 'operations'
                      ? 'Operations'
                      : section === 'organizations'
                        ? 'Organizations'
                        : 'Overview')}
            </h1>
          </div>
          <button onClick={refresh} disabled={busy || loading}>
            Refresh
          </button>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={refresh}>Try again</button>
          </div>
        )}
        {message && (
          <p role="status" className="success">
            {message}
          </p>
        )}
        {codes.length > 0 && (
          <section className="card warning">
            <h2>Save your recovery codes now</h2>
            <p>These codes are shown once. Each works only once.</p>
            {codes.map((c) => (
              <code key={c}>
                {c}
                <br />
              </code>
            ))}
            <button
              onClick={() => {
                download('platform-recovery-codes.json', codes);
              }}
            >
              Download codes
            </button>
            <button onClick={() => setCodes([])}>I saved them</button>
          </section>
        )}
        {loading && <p role="status">Loading…</p>}
        {section === 'overview' && !loading && (
          <>
            <div className="stats">
              <section className="card">
                <small>Organizations</small>
                <strong>{String(overview.organizations ?? 0)}</strong>
              </section>
              <section className="card">
                <small>Offline installations</small>
                <strong>{String(overview.offline ?? 0)}</strong>
              </section>
              <section className="card">
                <small>Outstanding agreements</small>
                <strong>
                  {money(String(overview.outstanding_paise ?? 0))}
                </strong>
              </section>
            </div>
            <section className="card">
              <h2>Subscription expiry — next 30 days and overdue</h2>
              <p>
                Recorded grants may not yet be applied. Check the organization?s
                verified hosted status.
              </p>
              <Table
                rows={(overview.expiring ?? []) as Record<string, unknown>[]}
              />
            </section>
            <section className="card">
              <h2>Operations needing attention</h2>
              <Table
                rows={(overview.operations ?? []) as Record<string, unknown>[]}
              />
            </section>
          </>
        )}
        {section === 'organizations' && !id && (
          <>
            <div className="toolbar">
              <form
                onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  setOffset(0);
                  setFilter({
                    q: value(d, 'q'),
                    edition: value(d, 'edition'),
                    state: value(d, 'state'),
                  });
                }}
              >
                <input
                  aria-label="Search organizations"
                  name="q"
                  placeholder="Search name or email"
                  maxLength={80}
                />
                <select aria-label="Edition" name="edition">
                  <option value="">All editions</option>
                  <option value="saas">Online</option>
                  <option value="offline">Offline</option>
                </select>
                <select aria-label="Lifecycle" name="state">
                  <option value="">All states</option>
                  <option>registered</option>
                  <option>pending</option>
                  <option>archived</option>
                </select>
                <button>Search</button>
              </form>
              <a className="button primary" href="#/organizations/new">
                Add organization
              </a>
            </div>
            <section className="card scroll">
              <table>
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Edition</th>
                    <th>Contact</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <a href={'#/organizations/' + o.id}>{o.name}</a>
                      </td>
                      <td>{o.edition}</td>
                      <td>{o.email}</td>
                      <td>
                        <span className="badge">{o.state}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!organizations.length && !loading && (
                <p>No matching organizations.</p>
              )}
              <div className="actions">
                <button
                  disabled={!offset}
                  onClick={() => setOffset((v) => Math.max(0, v - 50))}
                >
                  Previous
                </button>
                <button
                  disabled={!hasMore || offset >= 10000}
                  onClick={() => setOffset((v) => v + 50)}
                >
                  Next
                </button>
              </div>
            </section>
          </>
        )}
        {section === 'organizations' && id === 'new' && (
          <Form
            title="Organization details"
            submit="Register organization"
            busy={busy}
            dirty={mark}
            onSave={(d) =>
              run(async () => {
                const edition = value(d, 'edition'),
                  runtime = value(d, 'runtimeId'),
                  installation = value(d, 'installationId');
                const r = await api<{ id: string }>('organizations', {
                  name: value(d, 'name'),
                  email: value(d, 'email'),
                  contactName: value(d, 'contactName'),
                  phone: value(d, 'phone'),
                  edition,
                  mode: value(d, 'mode'),
                  ...(runtime ? { runtimeId: runtime } : {}),
                  ...(installation ? { installationId: installation } : {}),
                  requestKey: requestKey(),
                });
                location.hash = '/organizations/' + r.id;
              })
            }
          >
            <div className="grid">
              <Field label="Business name" name="name" />
              <Field label="Owner/contact email" name="email" type="email" />
              <Field label="Contact name" name="contactName" required={false} />
              <Field label="Phone" name="phone" required={false} />
              <Field label="Edition" name="edition">
                <option value="saas">Online SaaS</option>
                <option value="offline">Offline Windows</option>
              </Field>
              <Field label="Registration method" name="mode">
                <option value="create">Create online organization</option>
                <option value="link">Link existing organization</option>
              </Field>
              <Field
                label="Existing runtime organization UUID"
                name="runtimeId"
                required={false}
              />
              <Field
                label="Offline installation UUID"
                name="installationId"
                required={false}
              />
            </div>
            <p className="muted">
              Offline records require both existing host IDs. Online links are
              verified against the hosted service.
            </p>
          </Form>
        )}
        {org && (
          <>
            <div className="toolbar">
              <a href="#/organizations">← All organizations</a>
              <span className="badge">
                {org.edition} · {org.state}
              </span>
            </div>
            <nav className="tabs" aria-label="Organization sections">
              {[
                'overview',
                'subscription',
                'payments',
                'licenses',
                'activity',
              ].map((t) => (
                <a
                  key={t}
                  aria-current={tab === t ? 'page' : undefined}
                  href={'#/organizations/' + id + '/' + t}
                >
                  {t}
                </a>
              ))}
            </nav>
            {tab === 'overview' && (
              <>
                <section className="card">
                  <h2>Runtime identity</h2>
                  <p>
                    Organization: <code>{org.runtime_id}</code>
                  </p>
                  {org.installation_id && (
                    <p>
                      Installation: <code>{org.installation_id}</code>
                    </p>
                  )}
                  <p>
                    Commercial metadata changes do not change runtime access.
                  </p>
                </section>
                <Form
                  title="Contact and lifecycle"
                  busy={busy}
                  dirty={mark}
                  onSave={(d) =>
                    save(
                      base,
                      {
                        version: org.version,
                        name: value(d, 'name'),
                        email: value(d, 'email'),
                        contactName: value(d, 'contactName'),
                        phone: value(d, 'phone'),
                        state: value(d, 'state'),
                        requestKey: requestKey(),
                      },
                      'PUT',
                    )
                  }
                >
                  <div className="grid">
                    <Field
                      label="Business name"
                      name="name"
                      defaultValue={org.name}
                    />
                    <Field
                      label="Contact email"
                      name="email"
                      type="email"
                      defaultValue={org.email}
                    />
                    <Field
                      label="Contact name"
                      name="contactName"
                      defaultValue={org.contact_name}
                      required={false}
                    />
                    <Field
                      label="Phone"
                      name="phone"
                      defaultValue={org.phone}
                      required={false}
                    />
                    <Field
                      label="Lifecycle state"
                      name="state"
                      defaultValue={org.state}
                    >
                      <option value="registered">Registered</option>
                      <option value="archived">Archived</option>
                    </Field>
                  </div>
                  <p className="muted">
                    Archiving the directory entry does not suspend the customer.
                  </p>
                </Form>
                {org.edition === 'saas' && (
                  <section className="card">
                    <h2>Hosted status and owner onboarding</h2>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void save(base + '/check', {}).catch(() => {})
                      }
                    >
                      Verify hosted status
                    </button>
                    {detail!.observation ? (
                      <Table rows={[detail!.observation]} />
                    ) : (
                      <p>Hosted status has not been verified yet.</p>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = await api<{ url?: string; state?: string }>(
                            base + '/setup-link',
                            { requestKey: requestKey() },
                          );
                          setLink(
                            r.url ??
                              'Setup link pending. Resolve operation status, then generate a new link.',
                          );
                        }).catch(() => {})
                      }
                    >
                      Generate owner setup link
                    </button>
                    {link && (
                      <p className="secret" role="status">
                        {link}
                      </p>
                    )}
                    <p>
                      Links expire after 24 hours. Generating a new link
                      invalidates the previous one.
                    </p>
                  </section>
                )}
              </>
            )}
            {tab === 'subscription' && (
              <>
                <section className="card">
                  <h2>Agreements</h2>
                  <p>
                    Agreed terms and installed access are separate. Expired
                    subscriptions become read-only; perpetual licenses remain
                    valid after maintenance expiry.
                  </p>
                  <Table
                    rows={detail!.agreements.map((a) => ({
                      id: a.id,
                      type: a.kind,
                      total: money(a.total_paise),
                      paid: money(a.paid_paise),
                      balance: money(
                        (
                          BigInt(a.total_paise) - BigInt(a.paid_paise)
                        ).toString(),
                      ),
                      state: a.state,
                      starts: a.starts_at,
                      ends: a.ends_at,
                    }))}
                  />
                </section>
                <Form
                  title="Record agreed terms"
                  busy={busy}
                  dirty={mark}
                  onSave={(d) =>
                    save(base + '/agreements', {
                      kind: value(d, 'kind'),
                      startsAt: iso(d, 'startsAt'),
                      endsAt: value(d, 'endsAt') ? iso(d, 'endsAt') : null,
                      dueDate: value(d, 'dueDate'),
                      totalPaise: paise(value(d, 'amount')),
                      reference: value(d, 'reference'),
                      requestKey: requestKey(),
                    })
                  }
                >
                  <div className="grid">
                    <Field label="Agreement type" name="kind">
                      <option>subscription</option>
                      {org.edition === 'offline' && (
                        <>
                          <option>perpetual</option>
                          <option>maintenance</option>
                        </>
                      )}
                    </Field>
                    <Field
                      label="Starts at"
                      name="startsAt"
                      type="datetime-local"
                    />
                    <Field
                      label="Ends at (blank for perpetual)"
                      name="endsAt"
                      type="datetime-local"
                      required={false}
                    />
                    <Field label="Due date" name="dueDate" type="date" />
                    <Field label="Agreed total (INR)" name="amount" />
                    <Field
                      label="External reference"
                      name="reference"
                      required={false}
                    />
                  </div>
                  <p className="muted">
                    Internal agreement only. No GST sales invoice or tax
                    calculation is generated.
                  </p>
                </Form>
                <Form
                  title="Void agreement and retain history"
                  busy={busy}
                  dirty={mark}
                  onSave={(d) => {
                    const a = detail!.agreements.find(
                      (a) => a.id === value(d, 'agreementId'),
                    );
                    return save(base + '/agreements/' + a?.id + '/void', {
                      version: a?.version,
                      reason: value(d, 'reason'),
                      requestKey: requestKey(),
                    });
                  }}
                >
                  <Field label="Agreement" name="agreementId">
                    <option value="">Choose agreement</option>
                    {detail!.agreements
                      .filter((a) => a.state === 'active')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.kind} · {a.id}
                        </option>
                      ))}
                  </Field>
                  <Field label="Reason" name="reason" />
                </Form>
                {org.edition === 'saas' && (
                  <Form
                    title="Pause or resume business changes"
                    busy={busy}
                    dirty={mark}
                    onSave={(d) =>
                      save(base + '/pause', {
                        paused: value(d, 'paused') === 'true',
                        reason: value(d, 'reason'),
                        requestKey: requestKey(),
                      })
                    }
                  >
                    <p>
                      Confirm your password and a fresh code in Account security
                      first. Viewing and printing remain available.
                    </p>
                    <Field label="Action" name="paused">
                      <option value="true">Pause writes</option>
                      <option value="false">Resume writes</option>
                    </Field>
                    <Field label="Reason" name="reason" />
                  </Form>
                )}
              </>
            )}
            {tab === 'payments' && (
              <>
                <section className="card">
                  <h2>Receipts and adjustments</h2>
                  <Table
                    rows={detail!.receipts.map((r) => ({
                      id: r.id,
                      agreement: r.agreement_id,
                      received: money(r.amount_paise),
                      reference: r.reference,
                    }))}
                  />
                  <Table rows={detail!.adjustments} />
                </section>
                <Form
                  title="Record payment received"
                  busy={busy}
                  dirty={mark}
                  onSave={(d) =>
                    save(base + '/receipts', {
                      agreementId: value(d, 'agreementId'),
                      amountPaise: paise(value(d, 'amount')),
                      receivedAt: iso(d, 'receivedAt'),
                      reference: value(d, 'reference'),
                      requestKey: requestKey(),
                    })
                  }
                >
                  <Field label="Agreement" name="agreementId">
                    <option value="">Choose agreement</option>
                    {detail!.agreements
                      .filter((a) => a.state === 'active')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.kind} · balance{' '}
                          {money(
                            (
                              BigInt(a.total_paise) - BigInt(a.paid_paise)
                            ).toString(),
                          )}{' '}
                          · {a.id}
                        </option>
                      ))}
                  </Field>
                  <div className="grid">
                    <Field label="Received amount (INR)" name="amount" />
                    <Field
                      label="Received at"
                      name="receivedAt"
                      type="datetime-local"
                    />
                    <Field label="Payment reference" name="reference" />
                  </div>
                  <p>
                    No access is enabled automatically by recording payment.
                  </p>
                </Form>
                <Form
                  title="Record refund or reverse a receipt"
                  busy={busy}
                  dirty={mark}
                  onSave={(d) =>
                    save(base + '/adjustments', {
                      receiptId: value(d, 'receiptId'),
                      amountPaise: paise(value(d, 'amount')),
                      kind: value(d, 'kind'),
                      reason: value(d, 'reason'),
                      requestKey: requestKey(),
                    })
                  }
                >
                  <Field label="Receipt" name="receiptId">
                    <option value="">Choose receipt</option>
                    {detail!.receipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.reference} · {r.id}
                      </option>
                    ))}
                  </Field>
                  <Field label="Adjustment type" name="kind">
                    <option value="refund">Refund completed externally</option>
                    <option value="reversal">Reverse mistaken receipt</option>
                  </Field>
                  <Field label="Amount (INR)" name="amount" />
                  <Field label="Reason" name="reason" />
                </Form>
              </>
            )}
            {tab === 'licenses' && (
              <LicensePanel
                detail={detail!}
                busy={busy}
                mark={mark}
                save={save}
                run={run}
              />
            )}
            {tab === 'activity' && (
              <>
                <section className="card">
                  <h2>Organization activity</h2>
                  <Table rows={detail!.activity} />
                </section>
                <section className="card">
                  <h2>Operations</h2>
                  <OperationList
                    operations={detail!.operations}
                    busy={busy}
                    retry={(operation) =>
                      save('operations/' + operation + '/retry', {})
                    }
                  />
                </section>
              </>
            )}
          </>
        )}
        {section === 'operations' && (
          <section className="card">
            <h2>Cross-database operations</h2>
            <p>
              Completed means a committed SaaS receipt was verified. Failed
              requests can need reconciliation before retry.
            </p>
            <OperationList
              operations={operations}
              busy={busy}
              retry={(operation) =>
                save('operations/' + operation + '/retry', {})
              }
            />
          </section>
        )}
        {section === 'security' && (
          <>
            <Form
              title="Confirm sensitive actions (valid for five minutes)"
              submit="Confirm identity"
              busy={busy}
              dirty={mark}
              onSave={(d) =>
                save('auth/confirm', {
                  password: value(d, 'password'),
                  code: value(d, 'code'),
                })
              }
            >
              <Field label="Current password" name="password" type="password" />
              <Field label="Fresh verification or recovery code" name="code" />
            </Form>
            <Form
              title="Change password and sign out all sessions"
              busy={busy}
              dirty={mark}
              onSave={(d) =>
                run(async () => {
                  await api('auth/password', {
                    password: value(d, 'password'),
                  });
                  setSession(null);
                  setCsrf('');
                })
              }
            >
              <Field
                label="New password (at least 15 characters)"
                name="password"
                type="password"
              />
            </Form>
            <section className="card">
              <h2>Active sessions</h2>
              <Table rows={sessions} />
              <button
                disabled={busy}
                onClick={() =>
                  void save('auth/revoke-others', {}).catch(() => {})
                }
              >
                Revoke other sessions
              </button>
              <p>
                Keep the host recovery credential separately in protected
                storage. Account recovery requires host access and revokes all
                sessions.
              </p>
            </section>
          </>
        )}
        <footer>
          Publisher administration · Customer financial data is not available
          here.
        </footer>
      </main>
    </div>
  );
}
