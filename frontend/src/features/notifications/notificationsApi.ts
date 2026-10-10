import { api } from '../../lib/api';

export interface PushDevice {
  id: string;
  label: string;
  createdAt: string;
}

export interface NotificationSettings {
  email: { available: boolean; enabled: boolean };
  push: {
    /** The server has VAPID keys. */
    available: boolean;
    enabled: boolean;
    /** Put the reminder text in the notification itself. Off by default. */
    showText: boolean;
    publicKey: string | null;
    subscriptions: PushDevice[];
  };
}

export interface NotificationChanges {
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  pushShowText?: boolean;
}

export const fetchNotificationSettings = () => api<NotificationSettings>('/notifications');

export const updateNotificationSettings = (changes: NotificationChanges) =>
  api<NotificationSettings>('/notifications', { method: 'PATCH', body: JSON.stringify(changes) });

/** Registers (or renews) this browser's subscription. Idempotent for the same endpoint. */
export const registerPushSubscription = (subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label: string;
}) =>
  api<{ id: string }>('/notifications/push-subscriptions', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });

export const removePushSubscription = (id: string) =>
  api<void>(`/notifications/push-subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Is this browser endpoint one of the signed-in account's devices? Read-only: never registers. */
export const lookupPushSubscription = (endpoint: string) =>
  api<{ id: string | null }>('/notifications/push-subscriptions/lookup', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
