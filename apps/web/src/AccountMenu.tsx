import { useEffect, useId, useRef, useState } from 'react';
import type { SessionInfo } from '@gst/contracts';
import { Avatar, Icon } from './ui.js';
import { connectionHealthy } from './connection.js';
import type { ConnectionState } from './connection.js';

export function AccountMenu({
  info,
  connection,
  busy,
  onSelect,
  onLogout,
}: {
  info: SessionInfo;
  connection: ConnectionState;
  busy: boolean;
  onSelect: (tab: 'security' | 'system') => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const openAtEnd = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>(
      '[role=menuitem]:not(:disabled)',
    );
    (openAtEnd.current ? items?.[items.length - 1] : items?.[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const select = (action: () => void) => {
    trigger.current?.focus();
    setOpen(false);
    action();
  };
  return (
    <div className="account-menu" ref={root}>
      <button
        ref={trigger}
        className="account-trigger"
        aria-label={`Account menu for ${info.user.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          openAtEnd.current = false;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openAtEnd.current = event.key === 'ArrowUp';
            setOpen(true);
          }
        }}
      >
        <span className="account-avatar">
          <Avatar name={info.user.name} small />
          <span
            className={`account-connection-dot ${connectionHealthy(connection) ? 'is-connected' : 'needs-attention'}`}
          />
        </span>
        <span className="account-identity">
          <strong>{info.user.name}</strong>
          <small>{info.user.email}</small>
        </span>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div
          id={id}
          ref={menu}
          className="account-popover"
          role="menu"
          aria-label="Account menu"
          onKeyDown={(event) => {
            const items = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>(
                '[role=menuitem]:not(:disabled)',
              ) ?? [],
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            } else if (event.key === 'Tab') {
              trigger.current?.focus();
              setOpen(false);
            }
          }}
        >
          <div className="account-popover-heading">
            <strong>{info.user.name}</strong>
            <small>{info.user.email}</small>
          </div>
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={() => select(() => onSelect('security'))}
          >
            <Icon name="shield" size={18} />
            Account settings
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={() => select(() => onSelect('system'))}
          >
            <Icon name="server" size={18} />
            System status
            <span
              className={`status-dot ${connectionHealthy(connection) ? 'is-connected' : 'needs-attention'}`}
            />
          </button>
          <div className="account-menu-divider" />
          <button
            role="menuitem"
            tabIndex={-1}
            disabled={busy}
            onClick={() => select(onLogout)}
          >
            <Icon name="logout" size={18} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
