/* NoteFlow service worker: shows reminder notifications from Web Push. It caches nothing and
   never touches the network except to renew a push subscription the browser rotated. */

// Only same-origin paths are ever opened, whatever the payload says.
function safeTarget(raw) {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/reminders';
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'NoteFlow';
  const body = typeof data.body === 'string' ? data.body : 'You have a reminder due.';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // The same tag replaces an earlier copy instead of stacking a duplicate.
      tag: typeof data.tag === 'string' ? data.tag : 'noteflow-reminder',
      data: { url: safeTarget(data.url) },
      icon: '/icon.svg',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    safeTarget(event.notification.data && event.notification.data.url),
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// The browser rotated or expired the subscription: take a new one and tell the server. The
// session cookie rides along because this is a same-origin request.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription && event.oldSubscription.options;
      if (!options) return;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: options.applicationServerKey,
      });
      const json = sub.toJSON();
      await fetch('/api/notifications/push-subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // `replaces` makes this a renewal only: the server refuses it unless the signed-in
        // account owns the old endpoint, so a background event never moves a device.
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          label: 'Browser',
          replaces: event.oldSubscription.endpoint,
        }),
      });
    })().catch(() => {}),
  );
});
