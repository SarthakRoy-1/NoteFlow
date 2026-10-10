/** Thin wrapper over the browser's Push API, kept apart from React so each step is easy to follow. */

export type PermissionState = 'granted' | 'denied' | 'default';

export class PushError extends Error {
  constructor(
    public readonly kind: 'unsupported' | 'denied' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'PushError';
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export const permission = (): PermissionState =>
  pushSupported() ? (Notification.permission as PermissionState) : 'denied';

/** A short, human label for the device list ("Chrome on Windows"). */
export function deviceLabel(userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser';
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

function keyBytes(base64Url: string): Uint8Array {
  const padded = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function ready(): Promise<ServiceWorkerRegistration> {
  // Registering again is a no-op for the same script, so this is safe to call every time.
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** This browser's current subscription, or null. Never asks for permission. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await ready();
  return registration.pushManager.getSubscription();
}

/**
 * Ask for permission and subscribe. MUST be called from a click handler: browsers ignore (or
 * punish) permission prompts that were not triggered by the user.
 */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscription> {
  if (!pushSupported()) throw new PushError('unsupported', 'This browser does not support push.');
  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    throw new PushError('denied', 'Notifications were not allowed for this site.');
  }
  const registration = await ready();
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
  try {
    return await registration.pushManager.subscribe(options);
  } catch (err) {
    // A subscription made with a different server key blocks a new one: replace it.
    if ((err as DOMException).name === 'InvalidStateError') {
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      return registration.pushManager.subscribe(options);
    }
    throw new PushError('failed', 'Could not turn notifications on for this device.');
  }
}

export function subscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    throw new PushError('failed', 'The browser returned an incomplete subscription.');
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, label: deviceLabel() };
}
