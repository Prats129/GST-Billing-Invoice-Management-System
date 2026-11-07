import { useState } from 'react';
import type { Appearance } from '@gst/contracts';
import { ApiError } from './security-api.js';
import { Icon } from './ui.js';
import { Notification } from '@gst/ui/notifications';

export function AppearancePanel({
  appearance,
  onSave,
  onBusy,
  onSaved,
}: {
  appearance: Appearance;
  onSave: (value: Appearance) => Promise<void>;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(appearance);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const changed =
    value.mode !== appearance.mode || value.accent !== appearance.accent;
  return (
    <form
      className="appearance-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (saving || !changed) return;
        setSaving(true);
        onBusy(true);
        setError('');
        setSaved(false);
        void onSave(value)
          .then(() => {
            onSaved();
            setSaved(true);
          })
          .catch((reason: unknown) => {
            setError(
              reason instanceof ApiError
                ? reason.message
                : 'Appearance could not be saved. Please try again.',
            );
          })
          .finally(() => {
            setSaving(false);
            onBusy(false);
          });
      }}
    >
      <p className="settings-intro">
        Choose how your workspace looks. These settings belong to your account
        and follow you when you sign in on another device.
      </p>
      {error && <Notification message={error} onDismiss={() => setError('')} />}
      <fieldset disabled={saving} className="appearance-fieldset">
        <legend>Color mode</legend>
        <div className="appearance-options">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <label key={mode} className="appearance-option">
              <input
                type="radio"
                name="appearance-mode"
                value={mode}
                checked={value.mode === mode}
                onChange={() => {
                  setValue({ ...value, mode });
                  setSaved(false);
                }}
              />
              <Icon
                name={
                  mode === 'system'
                    ? 'monitor'
                    : mode === 'light'
                      ? 'sun'
                      : 'moon'
                }
              />
              {mode === 'system'
                ? 'Follow system'
                : mode === 'light'
                  ? 'Light'
                  : 'Dark'}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={saving} className="appearance-fieldset">
        <legend>Accent color</legend>
        <div className="appearance-options">
          {(['teal', 'blue', 'violet'] as const).map((accent) => (
            <label key={accent} className="appearance-option">
              <input
                type="radio"
                name="appearance-accent"
                value={accent}
                checked={value.accent === accent}
                onChange={() => {
                  setValue({ ...value, accent });
                  setSaved(false);
                }}
              />
              <span
                className={'accent-swatch swatch-' + accent}
                aria-hidden="true"
              />
              {accent === 'teal'
                ? 'Teal'
                : accent === 'blue'
                  ? 'Blue'
                  : 'Violet'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="appearance-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={saving || !changed}
        >
          {saving ? 'Saving...' : 'Save appearance'}
        </button>
        {saved && (
          <Notification
            message="Appearance saved."
            kind="success"
            onDismiss={() => setSaved(false)}
          />
        )}
      </div>
    </form>
  );
}
