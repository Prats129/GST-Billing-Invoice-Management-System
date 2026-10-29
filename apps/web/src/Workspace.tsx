import { useCallback, useEffect, useRef, useState } from 'react';
import { organizationListSchema, sessionInfoSchema } from '@gst/contracts';
import type {
  MemberView,
  OrganizationAccess,
  OrganizationSummary,
  RoleView,
  SessionInfo,
} from '@gst/contracts';
import { ApiError, securityRequest } from './security-api.js';
import {
  formText,
  formValues,
  MfaChallenge,
  MfaSetup,
  PasswordChange,
} from './security-forms.js';
import type { Mutate } from './security-forms.js';
import { MembersPanel } from './MembersPanel.js';
import { RolesPanel } from './RolesPanel.js';
import { SecurityPanel } from './SecurityPanel.js';
import { BusinessProfileScreen } from './business/BusinessProfileScreen.js';
import { CustomersScreen } from './business/CustomersScreen.js';
import { CatalogScreen } from './business/CatalogScreen.js';
import { InvoicesScreen } from './billing/InvoicesScreen.js';
import {
  Avatar,
  Badge,
  Brand,
  Dialog,
  EmptyState,
  Icon,
  PermissionList,
  formatDate,
} from './ui.js';
import type { IconName } from './ui.js';
import { ConnectionIndicator, ConnectionPanel } from './connection.js';
import type { ConnectionState } from './connection.js';

const views = [
  'overview',
  'business',
  'customers',
  'catalog',
  'invoices',
  'members',
  'roles',
  'security',
  'activity',
  'system',
] as const;
type View = (typeof views)[number];
const viewInfo: Record<
  View,
  { title: string; description: string; icon: IconName }
> = {
  invoices: {
    title: 'Invoices',
    description:
      'Create drafts, review totals and prepare your billing documents.',
    icon: 'roles',
  },
  business: {
    title: 'Business setup',
    description: 'Your business identity, registration and contact details.',
    icon: 'building',
  },
  customers: {
    title: 'Customers',
    description: 'A home for your customer details and addresses.',
    icon: 'users',
  },
  catalog: {
    title: 'Catalog',
    description: 'Products, services, pricing and tax classifications.',
    icon: 'roles',
  },
  overview: {
    title: 'Workspace overview',
    description: 'A clear view of your organization and its access.',
    icon: 'home',
  },
  members: {
    title: 'Members',
    description: 'The people who can access your organization.',
    icon: 'users',
  },
  roles: {
    title: 'Roles & permissions',
    description: 'Give each person the right level of access.',
    icon: 'roles',
  },
  security: {
    title: 'Account security',
    description: 'Protect your sign-in and manage active sessions.',
    icon: 'shield',
  },
  activity: {
    title: 'Activity log',
    description: 'Security and access changes in your organization.',
    icon: 'activity',
  },
  system: {
    title: 'System status',
    description: 'Check that your workspace services are available.',
    icon: 'server',
  },
};
function currentView(): View {
  const value = window.location.hash.replace(/^#\/?/, '');
  return views.includes(value as View) ? (value as View) : 'overview';
}
function activityText(action: string) {
  const labels: Record<string, string> = {
    'organization.provisioned': 'Organization created',
    'members.added': 'Member added',
    'members.invited': 'Member invited',
    'members.updated': 'Member access updated',
    'members.removed': 'Membership removed',
    'members.password_reset': 'Employee password reset',
    'members.ownership_changed': 'Organization ownership updated',
    'members.invitation_accepted': 'Invitation accepted',
    'roles.saved': 'Role saved',
    'roles.deleted': 'Role deleted',
    'identity.owner_recovered': 'Owner account recovered',
  };
  return labels[action] ?? action.replaceAll('.', ' ').replaceAll('_', ' ');
}

export function Workspace({
  connection,
  onCheck,
}: {
  connection: ConnectionState;
  onCheck: () => void;
}) {
  const [info, setInfo] = useState<SessionInfo | null>();
  const identityRef = useRef<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [invitations, setInvitations] = useState<
    { id: string; organizationName: string }[]
  >([]);
  const [selected, setSelected] = useState('');
  const [context, setContext] = useState<OrganizationAccess | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [roleOffset, setRoleOffset] = useState(0);
  const [memberOffset, setMemberOffset] = useState(0);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [audit, setAudit] = useState<
    { id: string; action: string; createdAt: string }[]
  >([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [view, setView] = useState<View>(currentView);
  const [mobileNav, setMobileNav] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const ready = Boolean(info && !info.mustChangePassword && !info.mfaRequired);
  const clearTenant = useCallback((resetSelection = true) => {
    if (resetSelection) setSelected('');
    setContext(null);
    setMembers([]);
    setRoles([]);
    setAudit([]);
  }, []);
  const navigate = useCallback((next: View) => {
    setView(next);
    window.location.hash = `/${next}`;
    setMobileNav(false);
    setError('');
    setRoleOffset(0);
    setMemberOffset(0);
  }, []);
  useEffect(() => {
    const changed = () => {
      setView(currentView());
      setRoleOffset(0);
      setMemberOffset(0);
      setMobileNav(false);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const logout = () => {
    setInfo(null);
    identityRef.current = undefined;
    clearTenant();
    setRecoveryCodes([]);
    navigate('overview');
  };
  const applySession = useCallback(
    (data: unknown) => {
      const next = sessionInfoSchema.parse(data);
      const changed = identityRef.current !== next.user.id;
      identityRef.current = next.user.id;
      setInfo(next);
      if (next.recoveryCodes) setRecoveryCodes(next.recoveryCodes);
      clearTenant(changed || next.mustChangePassword || next.mfaRequired);
      return next;
    },
    [clearTenant],
  );
  const refresh = useCallback(async () => {
    try {
      applySession(await securityRequest('/auth/session', undefined));
    } catch (e) {
      setInfo(null);
      identityRef.current = undefined;
      setRecoveryCodes([]);
      clearTenant();
      if (!(e instanceof ApiError && e.status === 401))
        setError(
          'We could not connect to your workspace. Check the connection and try again.',
        );
    }
  }, [applySession, clearTenant]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    let active = true;
    if (!ready) {
      setOrganizations([]);
      setInvitations([]);
      setOrgLoading(false);
      return;
    }
    setOrgLoading(true);
    void Promise.all([
      securityRequest('/organizations', undefined),
      securityRequest<typeof invitations>(
        '/organizations/invitations',
        undefined,
      ),
    ])
      .then(([list, invites]) => {
        if (!active) return;
        const next = organizationListSchema.parse(list);
        setOrganizations(next);
        setInvitations(invites);
        setSelected((previous) =>
          next.some((org) => org.id === previous)
            ? previous
            : (next[0]?.id ?? ''),
        );
      })
      .catch(() => {
        if (active)
          setError(
            'Your organizations could not be loaded. Refresh access to try again.',
          );
      })
      .finally(() => {
        if (active) setOrgLoading(false);
      });
    return () => {
      active = false;
    };
  }, [info, ready]);
  useEffect(() => {
    let active = true;
    setContext(null);
    setRoles([]);
    setMembers([]);
    setAudit([]);
    if (!selected || !ready) {
      setTenantLoading(false);
      return;
    }
    setTenantLoading(true);
    void securityRequest<OrganizationAccess>(
      `/organizations/${selected}`,
      undefined,
    )
      .then(async (ctx) => {
        const [roleList, memberList] = await Promise.all([
          ctx.access.permissions.includes('roles.read')
            ? securityRequest<RoleView[]>(
                `/organizations/${selected}/roles?offset=${roleOffset}`,
                undefined,
              )
            : [],
          ctx.access.permissions.includes('members.read')
            ? securityRequest<MemberView[]>(
                `/organizations/${selected}/members?offset=${memberOffset}`,
                undefined,
              )
            : [],
        ]);
        if (active) {
          setContext(ctx);
          setRoles(roleList);
          setMembers(memberList);
        }
      })
      .catch(() => {
        if (active)
          setError(
            'This organization is not available to your account. Refresh access or contact an owner.',
          );
      })
      .finally(() => {
        if (active) setTenantLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, ready, info, roleOffset, memberOffset]);
  const canMembers = Boolean(
    context?.access.permissions.some(
      (p) => p === 'members.read' || p === 'members.manage',
    ),
  );
  const canRoles = Boolean(
    context?.access.permissions.some(
      (p) => p === 'roles.read' || p === 'roles.manage',
    ),
  );
  const canAudit = Boolean(context?.access.permissions.includes('audit.read'));
  const canCustomers = Boolean(
    context?.access.permissions.some(
      (p) => p === 'customers.read' || p === 'customers.manage',
    ),
  );
  const canCatalog = Boolean(
    context?.access.permissions.some(
      (p) => p === 'catalog.read' || p === 'catalog.manage',
    ),
  );
  const allowed =
    view === 'invoices'
      ? Boolean(context?.access.permissions.includes('invoices.read'))
      : view === 'customers'
        ? canCustomers
        : view === 'catalog'
          ? canCatalog
          : view === 'members'
            ? canMembers
            : view === 'roles'
              ? canRoles
              : view === 'activity'
                ? canAudit
                : true;
  const activeView = !tenantLoading && context && !allowed ? 'overview' : view;
  useEffect(() => {
    let active = true;
    if (activeView !== 'activity' || !canAudit || !selected) return;
    setAuditLoading(true);
    void securityRequest<typeof audit>(
      `/organizations/${selected}/audit`,
      undefined,
    )
      .then(
        (events) => {
          if (active) setAudit(events);
        },
        () => {
          if (active)
            setError('Activity could not be loaded. Please try again.');
        },
      )
      .finally(() => {
        if (active) setAuditLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeView, canAudit, selected]);
  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.code === 'FORBIDDEN'
            ? 'You do not have permission to make this change. Ask an organization owner for help.'
            : e.message
          : 'This request could not be completed. Please try again.',
      );
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        clearTenant();
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  const mutate: Mutate = (path, body, method = 'POST') =>
    securityRequest(path, info?.csrfToken, method, body);
  const businessProps = {
    basePath: `/organizations/${selected}`,
    permissions: context?.access.permissions ?? [],
    busy,
    error,
    run,
    mutate,
    onClearError: () => setError(''),
  };
  async function reloadTenant() {
    if (!selected) return;
    const ctx = await securityRequest<OrganizationAccess>(
      `/organizations/${selected}`,
      undefined,
    );
    const [nextRoles, nextMembers] = await Promise.all([
      ctx.access.permissions.includes('roles.read')
        ? securityRequest<RoleView[]>(
            `/organizations/${selected}/roles?offset=${roleOffset}`,
            undefined,
          )
        : [],
      ctx.access.permissions.includes('members.read')
        ? securityRequest<MemberView[]>(
            `/organizations/${selected}/members?offset=${memberOffset}`,
            undefined,
          )
        : [],
    ]);
    setContext(ctx);
    setRoles(nextRoles);
    setMembers(nextMembers);
  }
  const formProps = { run, mutate, busy, onComplete: applySession };
  const errorBanner = error && (
    <div className="error" role="alert">
      <Icon name="info" size={19} />
      <span>{error}</span>
      <button
        className="icon-button"
        aria-label="Dismiss message"
        onClick={() => setError('')}
      >
        <Icon name="close" size={17} />
      </button>
    </div>
  );
  const recovery = recoveryCodes.length > 0 && (
    <section className="recovery recovery-codes">
      <div className="card-heading">
        <span className="feature-icon amber">
          <Icon name="key" />
        </span>
        <div>
          <h2>Save your recovery codes</h2>
          <p>
            Store these privately, away from this computer. Each code works
            once.
          </p>
        </div>
      </div>
      <pre>{recoveryCodes.join('\n')}</pre>
      <button
        className="button button-primary"
        onClick={() => setRecoveryCodes([])}
      >
        I have saved these codes
        <Icon name="check" size={16} />
      </button>
    </section>
  );
  const connectionDialog = connectionOpen && (
    <Dialog title="System status" onClose={() => setConnectionOpen(false)}>
      <ConnectionPanel connection={connection} onCheck={onCheck} />
    </Dialog>
  );
  if (!ready || !info)
    return (
      <main className="auth-shell">
        <aside className="auth-story">
          <Brand />
          <div className="auth-story-content">
            <span className="eyebrow">A WORKSPACE THAT WORKS FOR YOU</span>
            <h2>
              Your business.
              <br />
              Your people.
              <br />
              <em>One place.</em>
            </h2>
            <p>
              Keep your team connected, your access organised, and your
              workspace protected.
            </p>
            <div className="auth-illustration" aria-hidden="true">
              <div className="illustration-line" />
              <div className="auth-mini-card">
                <span className="feature-icon">
                  <Icon name="building" size={25} />
                </span>
                <div>
                  <strong>Your organization</strong>
                  <small>A shared space for your team</small>
                </div>
                <span className="illustration-check">
                  <Icon name="check" size={16} />
                </span>
              </div>
              <div className="auth-mini-bottom">
                <Icon name="shield" size={20} />
                <span>Access that stays in your control</span>
              </div>
            </div>
          </div>
          <p className="auth-story-footer">
            <Icon name="lock" size={15} />A private workspace for your business
          </p>
        </aside>
        <div className="auth-main">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <div className="auth-form-wrap">
            <span className="auth-icon">
              <Icon name={info ? 'shield' : 'lock'} size={26} />
            </span>
            {errorBanner}
            {recovery}
            {info === undefined ? (
              <div className="loading-state" role="status">
                <span className="spinner" />
                Opening your workspace…
              </div>
            ) : info === null ? (
              <>
                <div className="auth-heading">
                  <p className="eyebrow">WELCOME BACK</p>
                  <h1>Sign in to your workspace</h1>
                  <p>Use your account details to continue.</p>
                </div>
                <form
                  className="auth-form"
                  onSubmit={(event) => {
                    const data = formValues(event);
                    const field =
                      event.currentTarget.querySelector<HTMLInputElement>(
                        'input[type="password"]',
                      );
                    if (field) field.value = '';
                    void run(async () => {
                      applySession(
                        await securityRequest(
                          '/auth/login',
                          undefined,
                          'POST',
                          {
                            email: formText(data, 'email'),
                            password: formText(data, 'password'),
                          },
                        ),
                      );
                    });
                  }}
                >
                  <label>
                    Email
                    <input
                      type="email"
                      name="email"
                      required
                      maxLength={254}
                      autoComplete="username"
                      placeholder="you@business.com"
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      name="password"
                      required
                      maxLength={128}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                    />
                  </label>
                  <button
                    className="button button-primary button-full"
                    disabled={busy}
                  >
                    {busy ? <span className="spinner" /> : 'Sign in'}
                    <Icon name="arrow" size={18} />
                  </button>
                </form>
                <div className="auth-help">
                  <Icon name="info" size={16} />
                  <span>
                    Need an account? Ask your organization owner for access.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="auth-heading">
                  <p className="eyebrow">PROTECT YOUR WORKSPACE</p>
                  <h1>
                    {info.mustChangePassword &&
                    (!info.mfaEnabled || !info.mfaRequired)
                      ? 'Choose your own password'
                      : 'One more step to sign in'}
                  </h1>
                  <p>Signed in as {info.user.email}</p>
                </div>
                {info.mustChangePassword &&
                (!info.mfaEnabled || !info.mfaRequired) ? (
                  <PasswordChange {...formProps} forced />
                ) : info.mfaEnabled ? (
                  <MfaChallenge {...formProps} />
                ) : (
                  <MfaSetup {...formProps} />
                )}
                <button
                  className="button button-quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await mutate('/auth/logout');
                      logout();
                    })
                  }
                >
                  <Icon name="logout" size={16} />
                  Sign out
                </button>
              </>
            )}
          </div>
          <footer className="auth-footer">
            <button
              className="status-button"
              onClick={() => setConnectionOpen(true)}
            >
              <ConnectionIndicator connection={connection} />
            </button>
            <span>GST Billing workspace</span>
          </footer>
        </div>
        {connectionDialog}
      </main>
    );

  const navigation = (
    <>
      <div className="sidebar-brand">
        <Brand />
      </div>
      <div className="sidebar-workspace">
        <span className="workspace-symbol">
          <Icon name="building" />
        </span>
        <div>
          <strong title={context?.organization.name ?? 'Your organization'}>
            {context?.organization.name ?? 'Your organization'}
          </strong>
          <small>
            {context?.access.isOwner ? 'Owner workspace' : 'Business workspace'}
          </small>
        </div>
      </div>
      <nav aria-label="Workspace navigation">
        <p className="nav-label">WORKSPACE</p>
        {(
          [
            'overview',
            'business',
            ...(canCustomers ? ['customers'] : []),
            ...(canCatalog ? ['catalog'] : []),
            ...(context?.access.permissions.includes('invoices.read')
              ? ['invoices']
              : []),
            ...(canMembers ? ['members'] : []),
            ...(canRoles ? ['roles'] : []),
            ...(canAudit ? ['activity'] : []),
          ] as View[]
        ).map((item) => (
          <a
            key={item}
            href={`#/${item}`}
            aria-current={activeView === item ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate(item);
            }}
          >
            <Icon name={viewInfo[item].icon} />
            <span>
              {viewInfo[item].title === 'Workspace overview'
                ? 'Overview'
                : viewInfo[item].title}
            </span>
            {activeView === item && <span className="nav-active-dot" />}
          </a>
        ))}
        <p className="nav-label nav-label-settings">SETTINGS</p>
        {(['security', 'system'] as const).map((item) => (
          <a
            key={item}
            href={`#/${item}`}
            aria-current={activeView === item ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate(item);
            }}
          >
            <Icon name={viewInfo[item].icon} />
            <span>{viewInfo[item].title}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          className="sidebar-connection"
          onClick={() => navigate('system')}
        >
          <ConnectionIndicator connection={connection} />
        </button>
        <div className="sidebar-user">
          <Avatar name={info.user.name} small />
          <div>
            <strong>{info.user.name}</strong>
            <small title={info.user.email}>{info.user.email}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mutate('/auth/logout');
                logout();
              })
            }
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </>
  );
  const countText = (count: number) => (count === 50 ? '50+' : String(count));
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">{navigation}</aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <Icon name="chevron" size={14} />
            <strong>
              {viewInfo[activeView].title === 'Workspace overview'
                ? 'Overview'
                : viewInfo[activeView].title}
            </strong>
          </div>
          <div className="topbar-actions">
            <div className="organization-switcher">
              <Icon name="building" size={18} />
              <label className="sr-only" htmlFor="organization-selector">
                Organization
              </label>
              <select
                id="organization-selector"
                value={selected}
                onChange={(event) => {
                  if (event.target.value === selected) return;
                  clearTenant(false);
                  setSelected(event.target.value);
                  setRoleOffset(0);
                  setMemberOffset(0);
                  setError('');
                }}
              >
                {!organizations.length && (
                  <option value="">No active organization</option>
                )}
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="profile-button"
              aria-label="Open account settings"
              onClick={() => navigate('security')}
            >
              <Avatar name={info.user.name} small />
            </button>
          </div>
        </header>
        <main id="main-content" className="workspace-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {activeView === 'security' || activeView === 'system'
                  ? 'PERSONAL SETTINGS'
                  : 'YOUR ORGANIZATION'}
              </p>
              <h1>{viewInfo[activeView].title}</h1>
              <p>{viewInfo[activeView].description}</p>
            </div>
            <button
              className="button button-secondary refresh-access"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <Icon name="refresh" size={16} />
              Refresh access
            </button>
          </div>
          {errorBanner}
          {recovery}
          {invitations.length > 0 && (
            <section className="invitation-banner">
              <span className="feature-icon">
                <Icon name="mail" />
              </span>
              <div>
                <strong>You have organization invitations</strong>
                {invitations.map((invite) => (
                  <div className="invitation-row" key={invite.id}>
                    <span>{invite.organizationName}</span>
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await mutate(
                            `/organizations/invitations/${invite.id}/accept`,
                          );
                          await refresh();
                        })
                      }
                    >
                      Accept invitation
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {activeView === 'security' ? (
            <SecurityPanel
              info={info}
              busy={busy}
              run={run}
              mutate={mutate}
              onSession={applySession}
              onRefresh={refresh}
              onLogout={logout}
            />
          ) : activeView === 'system' ? (
            <ConnectionPanel connection={connection} onCheck={onCheck} />
          ) : orgLoading || tenantLoading ? (
            <div className="workspace-loading" role="status">
              <span className="spinner" />
              <h2>Opening your organization</h2>
              <p>Loading your team's workspace and access.</p>
            </div>
          ) : !context ? (
            <section className="surface">
              <EmptyState
                icon="building"
                title={
                  organizations.length
                    ? 'Organization access unavailable'
                    : 'No active organization'
                }
              >
                {' '}
                {organizations.length
                  ? 'Refresh access or contact an organization owner for help.'
                  : 'You have no active organization memberships. Contact your organization owner.'}
              </EmptyState>
            </section>
          ) : (
            <>
              {activeView === 'overview' && (
                <>
                  <div className="overview-greeting">
                    <div>
                      <span className="organization-emblem">
                        <Icon name="building" size={26} />
                      </span>
                      <div>
                        <h2>{context.organization.name}</h2>
                        <p>Your team and access, all in one place.</p>
                      </div>
                    </div>
                    <Badge tone={context.access.isOwner ? 'green' : 'blue'}>
                      {context.access.isOwner
                        ? 'Protected owner'
                        : 'Organization member'}
                    </Badge>
                  </div>
                  <div className="metric-grid">
                    <div className="metric-card">
                      <span className="metric-icon">
                        <Icon name="users" />
                      </span>
                      <p>Team members</p>
                      <strong>
                        {context.access.permissions.includes('members.read')
                          ? countText(members.length)
                          : 'Restricted'}
                      </strong>
                      <small>
                        {members.length === 50
                          ? 'First 50 members loaded'
                          : 'In your organization'}
                      </small>
                    </div>
                    <div className="metric-card">
                      <span className="metric-icon blue">
                        <Icon name="roles" />
                      </span>
                      <p>Access roles</p>
                      <strong>
                        {context.access.permissions.includes('roles.read')
                          ? countText(roles.length)
                          : 'Restricted'}
                      </strong>
                      <small>
                        {roles.length === 50
                          ? 'First 50 roles loaded'
                          : 'Permission-based team access'}
                      </small>
                    </div>
                    <div className="metric-card">
                      <span className="metric-icon amber">
                        <Icon name="shield" />
                      </span>
                      <p>Two-step verification</p>
                      <strong className="metric-word">
                        {info.mfaEnabled ? 'Enabled' : 'Not enabled'}
                      </strong>
                      <small>
                        {info.mfaEnabled
                          ? 'An extra layer of account protection'
                          : 'Add protection in account security'}
                      </small>
                    </div>
                  </div>
                  <div className="overview-grid">
                    <section className="surface">
                      <div className="section-heading">
                        <div>
                          <h2>Your workspace access</h2>
                          <p>
                            Permissions available to you in this organization.
                          </p>
                        </div>
                        <span className="feature-icon">
                          <Icon name="key" />
                        </span>
                      </div>
                      <PermissionList
                        permissions={context.access.permissions}
                      />
                      <div className="card-footer">
                        <span className="muted">
                          {context.access.isOwner
                            ? 'Owner access is protected.'
                            : 'Your roles determine your access.'}
                        </span>
                        {canRoles && (
                          <button
                            className="button button-quiet"
                            onClick={() => navigate('roles')}
                          >
                            View roles
                            <Icon name="arrow" size={16} />
                          </button>
                        )}
                      </div>
                    </section>
                    <section className="surface workspace-actions">
                      <h2>Make yourself at home</h2>
                      <p>Everything you need to manage your workspace.</p>
                      {canMembers && (
                        <button
                          className="action-row"
                          onClick={() => navigate('members')}
                        >
                          <span className="feature-icon">
                            <Icon name="users" />
                          </span>
                          <span>
                            <strong>Manage your team</strong>
                            <small>
                              Members, invitations and assigned roles
                            </small>
                          </span>
                          <Icon name="arrow" size={18} />
                        </button>
                      )}
                      <button
                        className="action-row"
                        onClick={() => navigate('security')}
                      >
                        <span className="feature-icon blue">
                          <Icon name="shield" />
                        </span>
                        <span>
                          <strong>Secure your account</strong>
                          <small>Password, authenticator and sessions</small>
                        </span>
                        <Icon name="arrow" size={18} />
                      </button>
                      {canAudit && (
                        <button
                          className="action-row"
                          onClick={() => navigate('activity')}
                        >
                          <span className="feature-icon amber">
                            <Icon name="activity" />
                          </span>
                          <span>
                            <strong>Review recent activity</strong>
                            <small>Stay informed about access changes</small>
                          </span>
                          <Icon name="arrow" size={18} />
                        </button>
                      )}
                    </section>
                  </div>
                </>
              )}
              {activeView === 'members' && canMembers && (
                <MembersPanel
                  members={members}
                  roles={roles}
                  access={context.access}
                  basePath={`/organizations/${selected}`}
                  currentUserId={info.user.id}
                  busy={busy}
                  run={run}
                  mutate={mutate}
                  reload={reloadTenant}
                  offset={memberOffset}
                  setOffset={setMemberOffset}
                  error={error}
                  onClearError={() => setError('')}
                />
              )}
              {activeView === 'business' && (
                <BusinessProfileScreen key={selected} {...businessProps} />
              )}
              {activeView === 'customers' && canCustomers && (
                <CustomersScreen key={selected} {...businessProps} />
              )}
              {activeView === 'catalog' && canCatalog && (
                <CatalogScreen key={selected} {...businessProps} />
              )}
              {activeView === 'invoices' && (
                <InvoicesScreen key={selected} {...businessProps} />
              )}
              {activeView === 'roles' && canRoles && (
                <RolesPanel
                  roles={roles}
                  access={context.access}
                  basePath={`/organizations/${selected}`}
                  busy={busy}
                  run={run}
                  mutate={mutate}
                  reload={reloadTenant}
                  offset={roleOffset}
                  setOffset={setRoleOffset}
                  error={error}
                  onClearError={() => setError('')}
                />
              )}
              {activeView === 'activity' && canAudit && (
                <section className="surface">
                  <div className="section-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <p>Latest 50 recorded security events.</p>
                    </div>
                    <button
                      className="button button-secondary"
                      disabled={busy || auditLoading}
                      onClick={() =>
                        void run(async () =>
                          setAudit(
                            await securityRequest(
                              `/organizations/${selected}/audit`,
                              undefined,
                            ),
                          ),
                        )
                      }
                    >
                      <Icon name="refresh" size={16} />
                      Refresh activity
                    </button>
                  </div>
                  {auditLoading ? (
                    <div className="loading-state" role="status">
                      <span className="spinner" />
                      Loading activity…
                    </div>
                  ) : audit.length ? (
                    <ol className="activity-list">
                      {audit.map((event) => (
                        <li key={event.id}>
                          <span className="activity-icon">
                            <Icon
                              name={
                                event.action.startsWith('roles.')
                                  ? 'roles'
                                  : 'users'
                              }
                              size={18}
                            />
                          </span>
                          <div>
                            <strong>{activityText(event.action)}</strong>
                            <p>Organization access and security</p>
                          </div>
                          <time dateTime={event.createdAt}>
                            {formatDate(event.createdAt)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState
                      icon="activity"
                      title="No activity recorded yet"
                    >
                      Security and access changes will appear here.
                    </EmptyState>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>GST Billing</span>
            <span>Business workspace</span>
          </footer>
        </main>
      </div>
      {mobileNav && (
        <Dialog title="Navigation" onClose={() => setMobileNav(false)}>
          <aside className="sidebar sidebar-mobile">{navigation}</aside>
        </Dialog>
      )}
      {connectionDialog}
    </div>
  );
}
