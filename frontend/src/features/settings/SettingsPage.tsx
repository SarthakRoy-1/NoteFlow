import { useState, type FormEvent } from 'react';
import { readTheme, saveTheme, type ThemeChoice } from '../../lib/theme';
import { useMe, useUpdateTimezone } from '../auth/useAuth';
import { errorMessage } from '../notes/useNotes';
import { SignInMethods } from './SignInMethods';

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function zoneOptions(current: string): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  // The saved value may be an alias the list omits (e.g. Asia/Calcutta); keep it selectable.
  return [...new Set(['UTC', current, ...zones])].sort((a, b) => a.localeCompare(b));
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function signInSummary(me: { signIn: { password: boolean; google: boolean } } | null | undefined) {
  if (!me) return '';
  if (me.signIn.password && me.signIn.google)
    return 'You can sign in with Google or your password.';
  if (me.signIn.password) return 'You sign in with your email and password.';
  return 'You sign in with Google. NoteFlow never sees your Google password.';
}

export function SettingsPage() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const { data: me } = useMe();
  const save = useUpdateTimezone();
  const saved = me?.timezone ?? 'UTC';
  const [choice, setChoice] = useState<string | null>(null);
  const value = choice ?? saved;
  const device = deviceTimezone();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(value, { onSuccess: () => setChoice(null) });
  };

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="pane-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <h2>Account</h2>
          <p className="muted">{signInSummary(me)}</p>
        </div>
        <dl className="settings-account">
          <dt>Name</dt>
          <dd>{me?.name}</dd>
          <dt>Email</dt>
          <dd>{me?.email}</dd>
        </dl>
      </div>

      {me && <SignInMethods me={me} />}

      <form className="settings-row settings-card" onSubmit={submit}>
        <div className="settings-label">
          <h2>Time zone</h2>
          <p className="muted">
            Due dates and times are shown in this zone, and words like “tomorrow” or “Friday 5pm” in
            your notes are read in it.
          </p>
        </div>
        <div className="settings-control">
          <div className="field">
            <label htmlFor="settings-timezone">Your time zone</label>
            <select
              id="settings-timezone"
              value={value}
              onChange={(e) => {
                save.reset();
                setChoice(e.target.value);
              }}
              disabled={save.isPending}
            >
              {zoneOptions(saved).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={save.isPending || value === saved}
            >
              {save.isPending ? 'Saving…' : 'Save time zone'}
            </button>
            {device && device !== value && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  save.reset();
                  setChoice(device);
                }}
                disabled={save.isPending}
              >
                Use this device’s ({device})
              </button>
            )}
          </div>
          {save.isError && (
            <p role="alert" className="alert alert-error">
              {errorMessage(save.error)}
            </p>
          )}
          {save.isSuccess && (
            <p role="status" className="muted">
              Saved. Existing due dates now show in {saved}; stored times are unchanged.
            </p>
          )}
        </div>
      </form>

      <div className="settings-row">
        <div className="settings-label">
          <h2>Appearance</h2>
          <p className="muted">
            Follows your device unless you choose a theme. Saved on this device.
          </p>
        </div>
        <div className="settings-control">
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <label key={t.value}>
                <input
                  type="radio"
                  name="theme"
                  value={t.value}
                  checked={theme === t.value}
                  onChange={() => {
                    setTheme(t.value);
                    saveTheme(t.value);
                  }}
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
