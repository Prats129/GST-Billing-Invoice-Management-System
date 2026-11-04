import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appearanceSchema,
  organizationListSchema,
  sessionInfoSchema,
} from '@gst/contracts';
import type {
  MemberView,
  OrganizationAccess,
  OrganizationSummary,
  RoleView,
  SessionInfo,
  Appearance,
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
import { AccountSettings } from './AccountSettings.js';
import { WorkspaceSidebar } from './WorkspaceSidebar.js';
import { PageActionsContext, UnsavedChangesContext } from './PageActions.js';
import { BusinessProfileScreen } from './business/BusinessProfileScreen.js';
import { CustomersScreen } from './business/CustomersScreen.js';
import { CatalogScreen } from './business/CatalogScreen.js';
import { InvoicesScreen } from './billing/InvoicesScreen.js';
import { Brand, Dialog, EmptyState, Icon, formatDate } from './ui.js';
import { WorkspaceHome } from './WorkspaceHome.js';
import {
  businessViews,
  canOpenView,
  currentView,
  viewInfo,
} from './workspace-navigation.js';
import type { View } from './workspace-navigation.js';
import { ConnectionIndicator, ConnectionPanel } from './connection.js';
import type { ConnectionState } from './connection.js';
import { useAppearance } from './appearance.js';

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
  // Appearance saves must not replace the session object: tenant-loading effects
  // depend on it and would unmount an editor with unsaved changes.
  const [appearanceOverride, setAppearanceOverride] = useState<{
    userId: string;
    value: Appearance;
  } | null>(null);
  const appearance =
    appearanceOverride?.userId === info?.user.id
      ? appearanceOverride?.value
      : info?.appearance;
  useAppearance(appearance);
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
  const [view, setView] = useState<View>(() =>
    ['security', 'system'].includes(currentView()) ? 'overview' : currentView(),
  );
  const lastView = useRef<View>(view);
  const [settingsTab, setSettingsTab] = useState<'security' | 'system' | null>(
    () => {
      const route = currentView();
      return route === 'security' || route === 'system' ? route : null;
    },
  );
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('gst.ui.sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [pageActions, setPageActions] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem('gst.ui.sidebar-collapsed', String(collapsed));
    } catch {
      /* Storage is optional in private/restricted browsers. */
    }
  }, [collapsed]);
  const unsaved = useRef(false);
  const settingsLeaveGuard = useRef<(() => boolean) | null>(null);
  const reportUnsaved = useCallback((dirty: boolean) => {
    unsaved.current = dirty;
  }, []);
  const discardWorkspace = () =>
    !unsaved.current ||
    window.confirm('Discard the unsaved changes in this workspace?');
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
    if (next === 'security' || next === 'system') {
      setSettingsTab(next);
      setMobileNav(false);
      return;
    }
    if (next === lastView.current && currentView() === next) {
      setMobileNav(false);
      return;
    }
    if (
      next !== lastView.current &&
      unsaved.current &&
      !window.confirm('Discard the unsaved changes in this workspace?')
    )
      return;
    unsaved.current = false;
    lastView.current = next;
    setSettingsTab(null);
    setView(next);
    window.location.hash = `/${next}`;
    setMobileNav(false);
    setError('');
    setRoleOffset(0);
    setMemberOffset(0);
  }, []);
  useEffect(() => {
    const changed = () => {
      const next = currentView();
      if (next === 'security' || next === 'system') {
        setSettingsTab(next);
        window.history.replaceState(
          window.history.state,
          '',
          '#/' + lastView.current,
        );
        return;
      }
      if (settingsLeaveGuard.current && !settingsLeaveGuard.current()) {
        window.history.replaceState(
          window.history.state,
          '',
          '#/' + lastView.current,
        );
        return;
      }
      if (
        next !== lastView.current &&
        unsaved.current &&
        !window.confirm('Discard the unsaved changes in this workspace?')
      ) {
        window.history.replaceState(
          window.history.state,
          '',
          '#/' + lastView.current,
        );
        return;
      }
      if (next !== lastView.current) unsaved.current = false;
      setSettingsTab(null);
      lastView.current = next;
      setView(next);
      setRoleOffset(0);
      setMemberOffset(0);
      setMobileNav(false);
    };
    if (['security', 'system'].includes(currentView())) changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const logout = () => {
    unsaved.current = false;
    setSettingsTab(null);
    setInfo(null);
    identityRef.current = undefined;
    clearTenant();
    setRecoveryCodes([]);
    navigate('overview');
  };
  const applySession = useCallback(
    (data: unknown) => {
      const next = sessionInfoSchema.parse(data);
      setAppearanceOverride(null);
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
  const allowed = canOpenView(view, context?.access.permissions ?? []);
  const activeView = !tenantLoading && context && !allowed ? 'overview' : view;
  useEffect(() => {
    if (!ready) return;
    lastView.current = activeView;
    document.title = `${viewInfo[activeView].title} · GST Billing`;
    document.getElementById('page-title')?.focus({ preventScroll: true });
  }, [activeView, ready]);
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
      if (
        e instanceof ApiError &&
        [401, 403].includes(e.status) &&
        e.code !== 'ENTITLEMENT_READ_ONLY'
      ) {
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
    readOnly: Boolean(
      context?.entitlement &&
      !['active', 'development'].includes(context.entitlement.status),
    ),
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

  const settingsViews = businessViews.filter((item) =>
    canOpenView(item, context?.access.permissions ?? []),
  );
  const inBusinessSettings = settingsViews.includes(activeView);
  const openSettings = (tab: 'security' | 'system') => {
    setMobileNav(false);
    setError('');
    requestAnimationFrame(() => setSettingsTab(tab));
  };
  const accountRun: typeof run = async (action) => {
    if (
      unsaved.current &&
      !window.confirm(
        'This security change refreshes your workspace and discards unsaved changes. Continue?',
      )
    )
      return;
    await run(action);
  };
  const navigation = (mobile = false) => (
    <WorkspaceSidebar
      view={activeView}
      permissions={context?.access.permissions ?? []}
      collapsed={collapsed}
      mobile={mobile}
      onToggle={() => setCollapsed((value) => !value)}
      onNavigate={navigate}
      info={info}
      connection={connection}
      busy={busy}
      onSettings={openSettings}
      onLogout={() =>
        void accountRun(async () => {
          await mutate('/auth/logout');
          logout();
        })
      }
    />
  );
  return (
    <div
      className={
        'app-shell workspace-refresh focused-workspace' +
        (collapsed ? ' sidebar-is-collapsed' : '')
      }
    >
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">{navigation()}</aside>
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
            <span className="breadcrumb-root">
              {inBusinessSettings ? 'Business settings' : 'Workspace'}
            </span>
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
                  if (!discardWorkspace()) return;
                  unsaved.current = false;
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
              className="icon-button refresh-access"
              aria-label="Refresh access"
              title="Refresh access"
              disabled={busy}
              onClick={() => {
                if (discardWorkspace()) {
                  unsaved.current = false;
                  void refresh();
                }
              }}
            >
              <Icon name="refresh" size={18} />
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {inBusinessSettings ? 'ORGANIZATION' : 'YOUR WORKSPACE'}
              </p>
              <h1 id="page-title" tabIndex={-1}>
                {inBusinessSettings
                  ? 'Business settings'
                  : viewInfo[activeView].title}
              </h1>
              <p>
                {inBusinessSettings
                  ? 'Manage your organization details and team access.'
                  : viewInfo[activeView].description}
              </p>
            </div>
            <div className="page-actions" ref={setPageActions} />
          </div>
          {inBusinessSettings && (
            <nav
              className="section-navigation"
              aria-label="Business settings sections"
            >
              {settingsViews.map((item) => (
                <a
                  key={item}
                  href={'#/' + item}
                  aria-current={item === activeView ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(item);
                  }}
                >
                  <Icon name={viewInfo[item].icon} size={17} />
                  {viewInfo[item].title}
                </a>
              ))}
            </nav>
          )}
          {!settingsTab && errorBanner}
          {!settingsTab && recovery}
          {context?.entitlement &&
            !['active', 'development'].includes(context.entitlement.status) && (
              <div className="warning-note" role="status">
                <strong>This organization is read-only.</strong>{' '}
                {context.entitlement.status === 'expired'
                  ? 'Your trial or subscription has expired. Contact your provider to renew.'
                  : 'Your license or subscription needs attention. Contact the host or platform operator.'}{' '}
                You can still view and print records you have permission to
                access.
              </div>
            )}
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
          <UnsavedChangesContext value={reportUnsaved}>
            <PageActionsContext value={pageActions}>
              {orgLoading || tenantLoading ? (
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
                    <WorkspaceHome
                      key={selected}
                      context={context}
                      info={info}
                      navigate={navigate}
                    />
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
            </PageActionsContext>
          </UnsavedChangesContext>
          <footer className="workspace-footer">
            <span>GST Billing</span>
            <span>Business workspace</span>
          </footer>
        </main>
      </div>
      {mobileNav && (
        <Dialog title="Navigation" onClose={() => setMobileNav(false)}>
          <aside className="sidebar sidebar-mobile">{navigation(true)}</aside>
        </Dialog>
      )}
      {settingsTab && (
        <AccountSettings
          initialTab={settingsTab}
          info={info}
          connection={connection}
          onCheck={onCheck}
          busy={busy}
          run={accountRun}
          mutate={mutate}
          leaveGuard={settingsLeaveGuard}
          onSession={applySession}
          onRefresh={refresh}
          onLogout={logout}
          onClose={() => setSettingsTab(null)}
          error={error}
          recovery={recovery}
          recoveryPending={recoveryCodes.length > 0}
          onClearError={() => setError('')}
          appearance={appearance ?? info.appearance}
          onAppearanceSave={async (value: Appearance) => {
            const next = appearanceSchema.parse(
              await mutate('/auth/appearance', value, 'PUT'),
            );
            setAppearanceOverride({ userId: info.user.id, value: next });
          }}
        />
      )}
      {connectionDialog}
    </div>
  );
}
