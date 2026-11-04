import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { RoleView } from '@gst/contracts';
export type RunAction = (action: () => Promise<void>) => Promise<void>;
export type Mutate = <T = unknown>(
  path: string,
  body?: unknown,
  method?: string,
) => Promise<T>;
export function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
export const formText = (data: FormData, key: string) =>
  String(data.get(key) ?? '');
export function PasswordFields({ temporary = false }: { temporary?: boolean }) {
  return (
    <>
      <label>
        {temporary ? 'Temporary password (new account only)' : 'New password'}
        <input
          name="newPassword"
          type="password"
          minLength={15}
          maxLength={128}
          required={!temporary}
          autoComplete="new-password"
        />
      </label>
      <small>Use at least 15 characters.</small>
    </>
  );
}
export function RoleSelection({
  roles,
  selected = [],
}: {
  roles: RoleView[];
  selected?: string[];
}) {
  const retained = selected.filter(
    (id) => !roles.some((role) => role.id === id),
  );
  return (
    <fieldset>
      <legend>Roles</legend>
      {retained.length > 0 && (
        <small>Assignments on other role pages will be retained.</small>
      )}
      {retained.map((id) => (
        <input key={id} type="hidden" name="roleIds" value={id} />
      ))}
      {roles.map((role) => (
        <label className="check" key={role.id}>
          <input
            type="checkbox"
            name="roleIds"
            value={role.id}
            defaultChecked={selected.includes(role.id)}
          />
          {role.name}
        </label>
      ))}
    </fieldset>
  );
}
interface SecurityFormProps {
  run: RunAction;
  mutate: Mutate;
  busy: boolean;
  onComplete: (data: unknown) => void;
}
export function PasswordChange({
  run,
  mutate,
  busy,
  onComplete,
  forced = false,
}: SecurityFormProps & { forced?: boolean }) {
  return (
    <form
      onSubmit={(event) => {
        const data = formValues(event);
        event.currentTarget.reset();
        void run(async () => {
          onComplete(
            await mutate('/auth/password', {
              currentPassword: formText(data, 'currentPassword'),
              newPassword: formText(data, 'newPassword'),
            }),
          );
        });
      }}
    >
      <h3>{forced ? 'Change your temporary password' : 'Change password'}</h3>
      <label>
        Current password
        <input
          name="currentPassword"
          type="password"
          required
          maxLength={128}
          autoComplete="current-password"
        />
      </label>
      <PasswordFields />
      <button disabled={busy}>Change password</button>
    </form>
  );
}
export function MfaSetup({
  run,
  mutate,
  busy,
  onComplete,
  onPendingChange,
}: SecurityFormProps & { onPendingChange?: (pending: boolean) => void }) {
  const [secret, setSecret] = useState('');
  useEffect(() => {
    onPendingChange?.(Boolean(secret));
    return () => onPendingChange?.(false);
  }, [secret, onPendingChange]);
  return (
    <div>
      <h3>Set up two-step verification</h3>
      {!secret ? (
        <form
          onSubmit={(event) => {
            const data = formValues(event);
            event.currentTarget.reset();
            void run(async () => {
              setSecret(
                (
                  await mutate<{ secret: string }>('/auth/mfa/enroll', {
                    password: formText(data, 'password'),
                  })
                ).secret,
              );
            });
          }}
        >
          <p>Confirm your password to add an authenticator app.</p>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy}>Start setup</button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            const data = formValues(event);
            void run(async () => {
              onComplete(
                await mutate('/auth/mfa/confirm', {
                  code: formText(data, 'code'),
                }),
              );
              setSecret('');
            });
          }}
        >
          <p>
            Add a time-based account in your authenticator app using this setup
            key. Keep it private.
          </p>
          <code className="secret">{secret}</code>
          <label>
            Authenticator code
            <input
              name="code"
              inputMode="numeric"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
            />
          </label>
          <button disabled={busy}>Verify and enable</button>
        </form>
      )}
    </div>
  );
}
export function MfaChallenge({
  run,
  mutate,
  busy,
  onComplete,
}: SecurityFormProps) {
  return (
    <form
      onSubmit={(event) => {
        const data = formValues(event);
        event.currentTarget.reset();
        void run(async () => {
          onComplete(
            await mutate('/auth/mfa/verify', { code: formText(data, 'code') }),
          );
        });
      }}
    >
      <h3>Two-step verification</h3>
      <label>
        Authenticator or recovery code
        <input
          name="code"
          required
          maxLength={64}
          autoComplete="one-time-code"
        />
      </label>
      <button disabled={busy}>Verify</button>
    </form>
  );
}
