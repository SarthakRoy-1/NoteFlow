import { api } from '../../lib/api';
import type { Recurrence } from '../reminders/remindersApi';

/** A reminder somebody else shared with the signed-in user. Deliberately small. */
export interface SharedReminder {
  /** The share's own id: the only handle the recipient has. */
  id: string;
  text: string;
  dueAt: string | null;
  dueHasTime: boolean;
  recurrence: Recurrence | null;
  from: { name: string };
  sharedAt: string;
  acknowledgedAt: string | null;
  /** Not acknowledged yet. */
  isNew: boolean;
  /** An occurrence has arrived and is not acknowledged yet. */
  due: boolean;
  occurrenceAt: string | null;
}

export interface SharedList {
  shared: SharedReminder[];
  /** The next alert time in the future, so the browser can wake up exactly then. */
  nextDueAt: string | null;
}

export const listShared = () => api<SharedList>('/shared-reminders');

export const acknowledgeShared = async (id: string) =>
  (
    await api<{ shared: SharedReminder }>(`/shared-reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ acknowledged: true }),
    })
  ).shared;

export const removeShared = (id: string) =>
  api<void>(`/shared-reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
