import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ReactNode } from 'react';
import type { SessionInfo } from '@gst/contracts';
import { Dialog, Icon } from './ui.js';
import { SecurityPanel } from './SecurityPanel.js';
import { ConnectionPanel } from './connection.js';
import type { ConnectionState } from './connection.js';
import type { Mutate, RunAction } from './security-forms.js';

export function AccountSettings({
  initialTab,
  info,
  connection,
  onCheck,
  busy,
  run,
  mutate,
  onSession,
  onRefresh,
  onLogout,
  onClose,
  error,
  recovery,
  recoveryPending,
  onClearError,
  leaveGuard,
}: {
  initialTab: 'security' | 'system';
  info: SessionInfo;
  connection: ConnectionState;
  onCheck: () => void;
  busy: boolean;
  run: RunAction;
  mutate: Mutate;
  onSession: (data: unknown) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onClose: () => void;
  error: string;
  recovery: ReactNode;
  recoveryPending: boolean;
  onClearError: () => void;
  leaveGuard: RefObject<(() => boolean) | null>;
}) {
  const [tab, setTab] = useState(initialTab);
  const dirty = useRef(false),
    id = useId();
  const pendingSetup = useRef(false);
  const reportPending = useCallback((pending: boolean) => {
    pendingSetup.current = pending;
  }, []);
  const beforeLeave = () => {
    if (busy) return false;
    if (recoveryPending) {
      window.alert(
        'Save your recovery codes and confirm that you have stored them before leaving account settings.',
      );
      return false;
    }
    if (
      (dirty.current || pendingSetup.current) &&
      !window.confirm(
        pendingSetup.current
          ? 'Leave without completing authenticator setup?'
          : 'Discard the unsaved account-security details?',
      )
    )
      return false;
    dirty.current = false;
    onClearError();
    return true;
  };
  const select = (next: typeof tab) => {
    if (next !== tab && beforeLeave()) setTab(next);
  };
  useEffect(() => {
    leaveGuard.current = beforeLeave;
    return () => {
      leaveGuard.current = null;
    };
  });
  const perform: RunAction = (action) =>
    run(async () => {
      await action();
      dirty.current = false;
    });
  return (
    <Dialog
      title="Settings"
      className="account-settings-dialog"
      wide
      busy={busy}
      onClose={() => {
        if (beforeLeave()) onClose();
      }}
    >
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={(event) => {
          const tabs = ['security', 'system'] as const;
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 'security'
              : event.key === 'End'
                ? 'system'
                : tabs[(tabs.indexOf(tab) + 1) % 2]!;
          if (next === tab || beforeLeave()) {
            setTab(next);
            document.getElementById(id + '-' + next)?.focus();
          }
        }}
      >
        {(['security', 'system'] as const).map((item) => (
          <button
            key={item}
            id={id + '-' + item}
            role="tab"
            aria-selected={tab === item}
            aria-controls={id + '-panel'}
            tabIndex={tab === item ? 0 : -1}
            disabled={busy}
            onClick={() => select(item)}
          >
            <Icon name={item === 'security' ? 'shield' : 'server'} size={18} />
            {item === 'security' ? 'Account security' : 'System status'}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={id + '-panel'}
        aria-labelledby={id + '-' + tab}
        tabIndex={0}
        onInputCapture={() => {
          dirty.current = true;
        }}
      >
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {recovery}
        {tab === 'security' ? (
          <SecurityPanel
            info={info}
            busy={busy}
            run={perform}
            mutate={mutate}
            onSession={onSession}
            onRefresh={onRefresh}
            onLogout={onLogout}
            beforeLeave={beforeLeave}
            onPendingSetup={reportPending}
          />
        ) : (
          <ConnectionPanel connection={connection} onCheck={onCheck} />
        )}
      </div>
    </Dialog>
  );
}
