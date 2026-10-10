import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '../notes/useNotes';
import {
  lookupPushSubscription,
  registerPushSubscription,
  removePushSubscription,
} from './notificationsApi';
import {
  PushError,
  currentSubscription,
  permission,
  pushSupported,
  subscribeThisDevice,
  subscriptionPayload,
} from './push';
import {
  NOTIFICATIONS_KEY,
  useNotificationSettings,
  useUpdateNotificationSettings,
} from './useNotifications';

/** What this browser can do right now. `on` carries the server's id for this device. */
type Device =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'blocked' }
  | { kind: 'off' }
  | { kind: 'on'; id: string };

export function NotificationSettings() {
  const { data, isPending, isError, error } = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const queryClient = useQueryClient();
  const [device, setDevice] = useState<Device>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pushAvailable = data?.push.available === true;
  const hasDevices = (data?.push.subscriptions.length ?? 0) > 0;

  // Work out whether THIS account has this browser as a device. Browser permission is browser-wide
  // and proves nothing about the account, so this only asks the server (read-only): it never
  // asks for permission and never registers or moves a subscription.
  useEffect(() => {
    if (!data) return;
    if (!pushSupported()) {
      setDevice({ kind: 'unsupported' });
      return;
    }
    if (!pushAvailable) return;
    let cancelled = false;
    const set = (next: Device) => {
      if (!cancelled) setDevice(next);
    };
    void (async () => {
      if (permission() === 'denied') return set({ kind: 'blocked' });
      if (permission() !== 'granted') return set({ kind: 'off' });
      const subscription = await currentSubscription();
      if (!subscription) return set({ kind: 'off' });
      const { id } = await lookupPushSubscription(subscription.endpoint);
      set(id ? { kind: 'on', id } : { kind: 'off' });
    })().catch(() => set({ kind: 'off' }));
    return () => {
      cancelled = true;
    };
  }, [data, pushAvailable]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });

  const enable = async () => {
    if (!data?.push.publicKey) return;
    setBusy(true);
    setProblem(null);
    try {
      const subscription = await subscribeThisDevice(data.push.publicKey);
      const { id } = await registerPushSubscription(subscriptionPayload(subscription));
      setDevice({ kind: 'on', id });
      await refresh();
    } catch (err) {
      if (err instanceof PushError && err.kind === 'denied') {
        setDevice({ kind: permission() === 'denied' ? 'blocked' : 'off' });
        setProblem('Notifications were not allowed, so nothing was turned on.');
      } else {
        setProblem(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (device.kind === 'on') await removePushSubscription(device.id);
      await (await currentSubscription())?.unsubscribe();
      setDevice({ kind: 'off' });
      await refresh();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-row settings-card" aria-labelledby="notifications-heading">
      <div className="settings-label">
        <h2 id="notifications-heading">Reminder notifications</h2>
        <p className="muted">
          Get told when a reminder is due even if NoteFlow is not open. In-app alerts always work
          while you are signed in.
        </p>
      </div>

      <div className="settings-control">
        {isPending && <p className="muted">Loading…</p>}
        {isError && (
          <p role="alert" className="alert alert-error">
            {errorMessage(error)}
          </p>
        )}

        {data && (
          <>
            <div className="field">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={data.email.enabled}
                  disabled={!data.email.available || update.isPending}
                  onChange={(e) => update.mutate({ emailEnabled: e.target.checked })}
                />
                <span>Email me when a reminder is due</span>
              </label>
              <p className="muted">
                {data.email.available
                  ? 'Sent to your account email. Reminders shared with you are included.'
                  : 'Email is not set up on this server, so no emails will be sent.'}
              </p>
            </div>

            <div className="field">
              <h3 className="settings-subhead">Push notifications on this device</h3>
              <PushState
                device={device}
                available={pushAvailable}
                busy={busy}
                onEnable={enable}
                onDisable={disable}
              />
              {problem && (
                <p role="alert" className="alert alert-error">
                  {problem}
                </p>
              )}
              {pushAvailable && hasDevices && (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={data.push.enabled}
                      disabled={update.isPending}
                      onChange={(e) => update.mutate({ pushEnabled: e.target.checked })}
                    />
                    <span>Send push notifications to my devices</span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={data.push.showText}
                      disabled={update.isPending}
                      onChange={(e) => update.mutate({ pushShowText: e.target.checked })}
                    />
                    <span>Show the reminder text in the notification</span>
                  </label>
                  <p className="muted">
                    Off by default: a notification can appear on a lock screen or a shared screen,
                    so it just says a reminder is due.
                  </p>
                  {data.push.subscriptions.length > 0 && (
                    <p className="muted">
                      {data.push.subscriptions.length === 1
                        ? '1 device is'
                        : `${data.push.subscriptions.length} devices are`}{' '}
                      subscribed: {data.push.subscriptions.map((s) => s.label).join(', ')}.
                    </p>
                  )}
                </>
              )}
            </div>

            {update.isError && (
              <p role="alert" className="alert alert-error">
                {errorMessage(update.error)}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function PushState({
  device,
  available,
  busy,
  onEnable,
  onDisable,
}: {
  device: Device;
  available: boolean;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  if (device.kind === 'unsupported') {
    return (
      <p className="muted">
        This browser does not support push notifications. Email and in-app alerts still work.
      </p>
    );
  }
  if (!available) {
    return <p className="muted">Push notifications are not set up on this server.</p>;
  }
  if (device.kind === 'blocked') {
    return (
      <p className="muted">
        Notifications are blocked for this site in your browser. Allow them in the site settings
        (the icon beside the address), then reload this page.
      </p>
    );
  }
  if (device.kind === 'on') {
    return (
      <div className="actions">
        <p className="muted">Notifications are on for this device.</p>
        <button type="button" className="button" onClick={onDisable} disabled={busy}>
          {busy ? 'Working…' : 'Turn off on this device'}
        </button>
      </div>
    );
  }
  return (
    <div className="actions">
      <button
        type="button"
        className="button button-primary"
        onClick={onEnable}
        disabled={busy || device.kind === 'checking'}
      >
        {busy ? 'Working…' : 'Enable notifications on this device'}
      </button>
      <p className="muted">
        Your browser may ask for permission. A browser&apos;s notifications belong to one NoteFlow
        account at a time, so turning them on here takes them over from any other account.
      </p>
    </div>
  );
}
