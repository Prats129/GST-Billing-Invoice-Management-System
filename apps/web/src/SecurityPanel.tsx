import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@gst/contracts';
import { securityRequest } from './security-api.js';
import {
  formText,
  formValues,
  MfaSetup,
  PasswordChange,
} from './security-forms.js';
import type { Mutate, RunAction } from './security-forms.js';
import { Icon, formatDate } from './ui.js';
interface Props {
  info: SessionInfo;
  busy: boolean;
  run: RunAction;
  mutate: Mutate;
  onSession: (data: unknown) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  beforeLeave: () => boolean;
  onPendingSetup: (pending: boolean) => void;
}
export function SecurityPanel({
  info,
  busy,
  run,
  mutate,
  onSession,
  onRefresh,
  onLogout,
  beforeLeave,
  onPendingSetup,
}: Props) {
  const [section, setSection] = useState<
    'password' | 'mfa' | 'sessions' | null
  >(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (section)
      panel.current
        ?.querySelector<HTMLInputElement>('input:not([type=hidden])')
        ?.focus();
  }, [section]);
  const choose = (next: typeof section) => {
    if (!busy && beforeLeave()) {
      setSection(next);
      setError('');
    }
  };
  const [devices, setDevices] = useState<
    { id: string; createdAt: string; lastSeenAt: string }[]
  >([]);
  const [error, setError] = useState('');
  const [remembered, setRemembered] = useState<
    { id: string; createdAt: string; lastSeenAt: string; expiresAt: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    void securityRequest<typeof devices>('/auth/sessions', undefined).then(
      (list) => {
        if (active) setDevices(list);
      },
      () => {
        if (active)
          setError('Cannot load sessions. Refresh access and try again.');
      },
    );
    void securityRequest<typeof remembered>(
      '/auth/trusted-devices',
      undefined,
    ).then(
      (list) => {
        if (active) setRemembered(list);
      },
      () => {
        if (active)
          setError('Cannot load remembered devices. Refresh and try again.');
      },
    );
    return () => {
      active = false;
    };
  }, [info.csrfToken]);
  const complete = (data: unknown) => {
    onSession(data);
  };
  return (
    <div className="security-layout" ref={panel}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!section ? (
        <div className="security-overview">
          <p className="settings-intro">
            Manage how you sign in and which devices can access your account.
          </p>
          <button
            className="security-option"
            aria-label="Change password"
            onClick={() => choose('password')}
          >
            <Icon name="key" />
            <span>
              <strong>Password</strong>
              <small>Update your account password.</small>
            </span>
            <Icon name="chevron" size={17} />
          </button>
          <button
            className="security-option"
            aria-label="Manage two-step verification"
            onClick={() => choose('mfa')}
          >
            <Icon name="shield" />
            <span>
              <strong>Two-step verification</strong>
              <small>
                {info.mfaEnabled
                  ? 'Enabled. Manage your authenticator and recovery codes.'
                  : 'Add an authenticator to protect your sign-in.'}
              </small>
            </span>
            <Icon name="chevron" size={17} />
          </button>
          <button
            className="security-option"
            aria-label="Review active sessions"
            onClick={() => choose('sessions')}
          >
            <Icon name="monitor" />
            <span>
              <strong>Active sessions</strong>
              <small>Review signed-in devices and revoke access.</small>
            </span>
            <Icon name="chevron" size={17} />
          </button>
        </div>
      ) : (
        <button
          className="button button-quiet settings-back"
          onClick={() => choose(null)}
        >
          <Icon name="arrow" size={16} />
          Account security
        </button>
      )}
      {section === 'password' && (
        <section className="surface security-card">
          <span className="feature-icon">
            <Icon name="key" />
          </span>
          <p>Use a strong, unique password for your workspace.</p>
          <PasswordChange
            mfaEnabled={info.mfaEnabled}
            busy={busy}
            run={run}
            mutate={mutate}
            onComplete={complete}
          />
        </section>
      )}
      {section === 'mfa' && (
        <section className="surface security-card">
          <p>
            {info.mfaMandatory
              ? 'Two-step verification is required for organization owners and access administrators.'
              : 'Two-step verification is optional for your account. Enable it for extra protection.'}
          </p>
          <span className="feature-icon blue">
            <Icon name="shield" />
          </span>
          {info.mfaEnabled ? (
            <form
              onSubmit={(event) => {
                const data = formValues(event);
                const action = (
                  event.nativeEvent as SubmitEvent
                ).submitter?.getAttribute('value');
                event.currentTarget.reset();
                void run(async () => {
                  complete(
                    await mutate(
                      action === 'disable'
                        ? '/auth/mfa/disable'
                        : '/auth/mfa/recovery-codes',
                      {
                        password: formText(data, 'password'),
                        code: formText(data, 'code'),
                      },
                    ),
                  );
                });
              }}
            >
              <h3>Two-step verification is enabled</h3>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  maxLength={128}
                />
              </label>
              <label>
                Fresh authenticator or recovery code
                <input
                  name="code"
                  required
                  maxLength={64}
                  autoComplete="one-time-code"
                />
              </label>
              <button disabled={busy} value="regenerate">
                Replace recovery codes
              </button>
              {!info.mfaMandatory && (
                <button className="secondary" disabled={busy} value="disable">
                  Disable two-step verification
                </button>
              )}
            </form>
          ) : (
            <MfaSetup
              onPendingChange={onPendingSetup}
              busy={busy}
              run={run}
              mutate={mutate}
              onComplete={complete}
            />
          )}
        </section>
      )}
      {section === 'sessions' && (
        <section className="surface sessions-card">
          <div className="section-heading">
            <div>
              <h2>Active sessions</h2>
              <p>Review access and sign out devices you no longer use.</p>
            </div>
            <span className="feature-icon">
              <Icon name="monitor" />
            </span>
          </div>
          {devices.map((device) => (
            <div className="row" key={device.id}>
              <span>
                Started {formatDate(device.createdAt)}
                <br />
                Last active {formatDate(device.lastSeenAt)}
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await mutate(
                      `/auth/sessions/${device.id}`,
                      undefined,
                      'DELETE',
                    );
                    await onRefresh();
                    setDevices((previous) =>
                      previous.filter((item) => item.id !== device.id),
                    );
                  })
                }
              >
                Revoke session
              </button>
            </div>
          ))}
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await mutate('/auth/logout-all');
                onLogout();
              })
            }
          >
            Sign out all sessions and forget all devices
          </button>
          <h3>Remembered devices</h3>
          <p>
            These browsers can skip the login code until expiry. Forgetting one
            requires a code at its next login; use sign out all above to end
            existing sessions too.
          </p>
          {remembered.length === 0 && <p>No remembered devices.</p>}
          {remembered.map((device) => (
            <div className="row" key={device.id}>
              <span>
                Remembered {formatDate(device.createdAt)}
                <br />
                Last used {formatDate(device.lastSeenAt)} · Expires{' '}
                {formatDate(device.expiresAt)}
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await mutate(
                      `/auth/trusted-devices/${device.id}`,
                      undefined,
                      'DELETE',
                    );
                    setRemembered((previous) =>
                      previous.filter((item) => item.id !== device.id),
                    );
                  })
                }
              >
                Forget device
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
