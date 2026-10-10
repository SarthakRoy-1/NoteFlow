import { api } from '../../lib/api';

/** Never contains a token: only what the Settings page needs to describe the connection. */
export interface CalendarStatus {
  /** The server has Google OAuth credentials, so connecting is possible at all. */
  available: boolean;
  connected: boolean;
  /** "needs_reconnect": Google no longer accepts the stored permission. */
  status: 'connected' | 'needs_reconnect' | null;
  googleEmail: string | null;
}

export const fetchCalendarStatus = () => api<CalendarStatus>('/calendar/status');

/** Returns the Google consent URL; the browser then navigates to it. */
export const startCalendarConnect = async () =>
  (await api<{ url: string }>('/calendar/connect', { method: 'POST' })).url;

export const disconnectCalendar = () => api<void>('/calendar/disconnect', { method: 'POST' });

export interface CalendarSyncResult {
  /** "needs_reconnect": Google refused the stored permission. */
  result: 'ok' | 'not_connected' | 'needs_reconnect';
  /** Reminders created or updated in Google Calendar. */
  synced: number;
  /** Reminders Google refused this time; they stay saved and are tried again on the next sync. */
  failed: number;
  /** Eligible reminders still waiting after this call. */
  remaining: number;
}

const MAX_ROUNDS = 20;

/**
 * "Sync existing reminders". The server sends one small batch per call, so keep asking until
 * nothing is left, a round makes no progress (a temporary Google problem), or access is refused.
 */
export async function syncCalendar(): Promise<CalendarSyncResult> {
  const total: CalendarSyncResult = { result: 'ok', synced: 0, failed: 0, remaining: 0 };
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const r = await api<CalendarSyncResult>('/calendar/sync', { method: 'POST' });
    total.result = r.result;
    total.synced += r.synced;
    total.failed += r.failed;
    total.remaining = r.remaining;
    if (r.result !== 'ok' || r.remaining === 0 || r.synced === 0) break;
  }
  return total;
}
