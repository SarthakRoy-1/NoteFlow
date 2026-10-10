import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CloseIcon } from '../../components/icons';
import { readTheme, saveTheme, type ThemeChoice } from '../../lib/theme';
import { useAuthConfig, useMe, useUpdateTimezone } from '../auth/useAuth';
import { CalendarSettings } from '../calendar/CalendarSettings';
import { LegalLinks } from '../legal/LegalLinks';
import { NotificationSettings } from '../notifications/NotificationSettings';
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

function signInSummary(
  me: { signIn: { password: boolean; google: boolean } } | null | undefined,
  passwordAuth: boolean,
) {
  if (!me) return '';
  if (!passwordAuth) return 'You sign in with Google. NoteFlow never sees your Google password.';
  if (me.signIn.password && me.signIn.google)
    return 'You can sign in with Google or your password.';
  if (me.signIn.password) return 'You sign in with your email and password.';
  return 'You sign in with Google. NoteFlow never sees your Google password.';
}

export function SettingsPage() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const { data: me } = useMe();
  const passwordAuth = useAuthConfig().data?.passwordAuthEnabled === true;
  const save = useUpdateTimezone();
  const saved = me?.timezone ?? 'UTC';
  const [choice, setChoice] = useState<string | null>(null);
  const value = choice ?? saved;
  const device = deviceTimezone();

  // Closing returns to wherever the user came from (the gear and name links push a history entry),
  // or to Notes when Settings was opened directly. An unsaved time-zone choice is never dropped
  // silently: the user is asked first.
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmingClose, setConfirmingClose] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const unsaved = choice !== null && choice !== saved;
  const leave = () => (location.key !== 'default' ? navigate(-1) : navigate('/notes'));
  const close = () => (unsaved ? setConfirmingClose(true) : leave());
  useEffect(() => {
    if (confirmingClose) confirmRef.current?.focus();
  }, [confirmingClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(value, { onSuccess: () => setChoice(null) });
  };

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="pane-header settings-header">
        <h1>Settings</h1>
        <button type="button" className="icon-button" onClick={close} aria-label="Close settings">
          <CloseIcon />
        </button>
      </div>
      {confirmingClose && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="alertdialog"
          aria-label="Unsaved changes"
          className="alert unsaved-close"
        >
          <p>You have an unsaved time zone change. Close Settings and discard it?</p>
          <div className="actions">
            <button type="button" className="button" onClick={() => setConfirmingClose(false)}>
              Keep editing
            </button>
            <button type="button" className="button button-primary" onClick={leave}>
              Discard and close
            </button>
          </div>
        </div>
      )}

      <div className="settings-row">
        <div className="settings-label">
          <h2>Account</h2>
          <p className="muted">{signInSummary(me, passwordAuth)}</p>
        </div>
        <dl className="settings-account">
          <dt>Name</dt>
          <dd>{me?.name}</dd>
          <dt>Email</dt>
          <dd>{me?.email}</dd>
        </dl>
      </div>

      {me && passwordAuth && <SignInMethods me={me} />}

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

      <CalendarSettings />

      <NotificationSettings />

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

      <div className="settings-legal">
        <LegalLinks />
      </div>
    </section>
  );
}
