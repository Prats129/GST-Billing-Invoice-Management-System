import { useId, useState } from 'react';
import type { FocusEvent, PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Permission, SessionInfo } from '@gst/contracts';
import { Brand, Icon } from './ui.js';
import type { IconName } from './ui.js';
import type { ConnectionState } from './connection.js';
import { AccountMenu } from './AccountMenu.js';
import {
  businessViews,
  primaryViews,
  canOpenView,
  viewInfo,
} from './workspace-navigation.js';
import type { View } from './workspace-navigation.js';

function SidebarLink({
  view,
  label,
  icon,
  active,
  collapsed,
  onNavigate,
}: {
  view: View;
  label: string;
  icon: IconName;
  active: boolean;
  collapsed: boolean;
  onNavigate: (view: View) => void;
}) {
  const id = useId();
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(
    null,
  );
  const show = (
    event: FocusEvent<HTMLAnchorElement> | PointerEvent<HTMLAnchorElement>,
  ) => {
    if (!collapsed) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setTooltip({
      top: bounds.top + bounds.height / 2,
      left: bounds.right + 12,
    });
  };
  return (
    <>
      <a
        href={'#/' + view}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        aria-describedby={collapsed && tooltip ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={() => setTooltip(null)}
        onFocus={show}
        onBlur={() => setTooltip(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setTooltip(null);
        }}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          setTooltip(null);
          onNavigate(view);
        }}
      >
        <Icon name={icon} />
        <span className="sidebar-link-label">{label}</span>
      </a>
      {collapsed &&
        tooltip &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="sidebar-tooltip"
            style={tooltip}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
export function WorkspaceSidebar({
  view,
  permissions,
  collapsed,
  mobile = false,
  onToggle,
  onNavigate,
  info,
  connection,
  busy,
  onSettings,
  onLogout,
}: {
  view: View;
  permissions: Permission[];
  collapsed: boolean;
  mobile?: boolean;
  onToggle: () => void;
  onNavigate: (view: View) => void;
  info: SessionInfo;
  connection: ConnectionState;
  busy: boolean;
  onSettings: (tab: 'security' | 'system') => void;
  onLogout: () => void;
}) {
  const id = useId(),
    compact = collapsed && !mobile;
  const settings = businessViews.filter((item) =>
    canOpenView(item, permissions),
  );
  return (
    <>
      <div className="sidebar-brand">
        <Brand />
        {!mobile && (
          <button
            className="sidebar-toggle icon-button"
            aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!compact}
            aria-controls={id}
            onClick={onToggle}
          >
            <Icon name="chevron" size={18} />
          </button>
        )}
      </div>
      <nav
        id={id}
        className="primary-navigation"
        aria-label="Workspace navigation"
      >
        {primaryViews
          .filter((item) => canOpenView(item, permissions))
          .map((item) => (
            <SidebarLink
              key={item}
              view={item}
              label={item === 'overview' ? 'Overview' : viewInfo[item].title}
              icon={viewInfo[item].icon}
              active={view === item}
              collapsed={compact}
              onNavigate={onNavigate}
            />
          ))}
        {settings.length > 0 && (
          <div className="sidebar-settings">
            <SidebarLink
              view={settings[0]!}
              label="Business settings"
              icon="settings"
              active={businessViews.includes(view)}
              collapsed={compact}
              onNavigate={onNavigate}
            />
          </div>
        )}
      </nav>
      <div className="sidebar-bottom">
        <AccountMenu
          info={info}
          connection={connection}
          busy={busy}
          onSelect={onSettings}
          onLogout={onLogout}
        />
      </div>
    </>
  );
}
