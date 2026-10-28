import { useEffect, useState } from 'react';
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
}
export function SecurityPanel({
  info,
  busy,
  run,
  mutate,
  onSession,
  onRefresh,
  onLogout,
}: Props) {
  const [devices, setDevices] = useState<
    { id: string; createdAt: string; lastSeenAt: string }[]
  >([]);
  const [error, setError] = useState('');
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
    return () => {
      active = false;
    };
  }, [info.csrfToken]);
  const complete = (data: unknown) => {
    onSession(data);
  };
  return (
    <div className="security-layout">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="surface security-card">
        <span className="feature-icon">
          <Icon name="key" />
        </span>
        <p>Use a strong, unique password for your workspace.</p>
        <PasswordChange
          busy={busy}
          run={run}
          mutate={mutate}
          onComplete={complete}
        />
      </section>
      <section className="surface security-card">
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
            busy={busy}
            run={run}
            mutate={mutate}
            onComplete={complete}
          />
        )}
      </section>
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
          Sign out all sessions
        </button>
      </section>
    </div>
  );
}
