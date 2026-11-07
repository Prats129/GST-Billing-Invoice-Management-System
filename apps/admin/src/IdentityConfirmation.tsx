import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Notification } from '@gst/ui/notifications';
export function IdentityConfirmation({
  onConfirmed,
  onCancel,
}: {
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    ref.current?.querySelector('input')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-identity-title"
      className="identity-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="confirm-identity-title">Confirm your identity</h2>
      <p>
        This action needs your password and a fresh authenticator or recovery
        code. Your current page and form will stay open.
      </p>
      {error && <Notification message={error} onDismiss={() => setError('')} />}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const form = event.currentTarget,
            data = new FormData(form);
          const password = String(data.get('password') ?? ''),
            code = String(data.get('code') ?? '');
          form.reset();
          setBusy(true);
          setError('');
          void api('auth/confirm', { password, code })
            .then(onConfirmed, (reason: unknown) => {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'Verification failed. Try a fresh code.',
              );
              ref.current?.querySelector('input')?.focus();
            })
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Current password
            <input
              name="password"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <label>
            Fresh verification or recovery code
            <input
              name="code"
              required
              maxLength={64}
              autoComplete="one-time-code"
            />
          </label>
          <div className="recovery-actions">
            <button className="primary">
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
