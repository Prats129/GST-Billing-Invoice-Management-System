import { useEffect, useState } from 'react';
import { securityRequest } from './security-api.js';
import { Notification } from '@gst/ui/notifications';
export function OwnerSetup({ token }: { token: string }) {
  const [newAccount, setNewAccount] = useState<boolean | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false);
  useEffect(() => {
    let active = true;
    void securityRequest<{ newAccount: boolean }>(
      '/owner-setup/check',
      undefined,
      'POST',
      { token },
    )
      .then((r) => {
        if (active) setNewAccount(r.newAccount);
      })
      .catch(() => {
        if (active)
          setError(
            'This setup link is invalid, expired or already used. Ask your provider for a new link.',
          );
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <main className="auth-shell">
      <section
        className="surface"
        style={{ maxWidth: 520, margin: '8vh auto', padding: 24 }}
      >
        <h1>Set up your business workspace</h1>
        {error && (
          <Notification message={error} onDismiss={() => setError('')} />
        )}
        {complete ? (
          <>
            <p role="status">
              Your account is ready. Sign in and complete two-step verification
              to continue.
            </p>
            <a href="/#/overview">Go to sign in</a>
          </>
        ) : newAccount === null ? (
          <p>Checking setup link…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const password = String(data.get('password') ?? '');
              if (newAccount && password !== data.get('confirmation')) {
                setError('Passwords do not match.');
                return;
              }
              setBusy(true);
              setError('');
              void (async () => {
                let csrf: string | undefined;
                if (!newAccount) {
                  const s = await securityRequest<{ csrfToken: string }>(
                    '/auth/session',
                    undefined,
                  );
                  csrf = s.csrfToken;
                }
                await securityRequest('/owner-setup/complete', csrf, 'POST', {
                  token,
                  ...(newAccount ? { password } : {}),
                });
                setComplete(true);
                history.replaceState(null, '', '#/owner-setup/completed');
              })()
                .catch(() =>
                  setError(
                    'Setup could not be completed. Check the link and, for an existing account, sign in with the invited account and complete MFA first.',
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <fieldset disabled={busy}>
              {newAccount ? (
                <>
                  <label>
                    New password
                    <input
                      name="password"
                      type="password"
                      minLength={15}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <label>
                    Confirm password
                    <input
                      name="confirmation"
                      type="password"
                      minLength={15}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                </>
              ) : (
                <p>
                  Use your existing business account.{' '}
                  <a href="/#/overview" target="_blank" rel="noreferrer">
                    Sign in and complete MFA in another tab
                  </a>
                  , then return here to accept ownership. This will not change
                  your password.
                </p>
              )}
              <button className="button button-primary">
                {newAccount
                  ? 'Set password and accept'
                  : 'Accept with signed-in account'}
              </button>
            </fieldset>
          </form>
        )}
      </section>
    </main>
  );
}
