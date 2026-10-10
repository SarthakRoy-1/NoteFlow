import type { DueInput } from '../../components/DueFields';
import { api } from '../../lib/api';

export const REMINDER_TEXT_MAX = 200;
export const REMINDER_PERSON_MAX = 80;

/** A repeating schedule: ISO weekdays (1 = Monday ... 7 = Sunday) and an optional "HH:mm". */
export interface Recurrence {
  days: number[];
  time: string | null;
}

export interface ShareRecipient {
  shareId: string;
  name: string;
  email: string;
}

export interface Reminder {
  id: string;
  text: string;
  /** A person named in the note. Informational only: use "Share" to really notify a user. */
  person: string | null;
  /** UTC instant, or null when the note gave no date/time (such a reminder never alerts). */
  dueAt: string | null;
  /** false = only a date was given; dueAt is then the start of that local day. */
  dueHasTime: boolean;
  /** Set for a repeating reminder; dueAt is then its next occurrence. */
  recurrence: Recurrence | null;
  status: 'pending' | 'acknowledged' | 'dismissed';
  acknowledgedAt: string | null;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  sourceNote: { id: string; title: string };
  /** Users this reminder was shared with (only its owner ever sees this). */
  sharedWith: ShareRecipient[];
}

export interface DueReminders {
  reminders: Reminder[];
  /** The next pending alert time in the future, so the browser can wake up exactly then. */
  nextDueAt: string | null;
}

export interface ReminderChanges {
  text?: string;
  person?: string | null;
  due?: DueInput;
  /** `{ days }` repeats on those weekdays at the due time; `null` stops repeating. */
  recurrence?: { days: number[] } | null;
  acknowledged?: boolean;
}

export interface Share {
  id: string;
  recipient: { name: string; email: string };
  createdAt: string;
  acknowledgedAt: string | null;
}

export const shareReminder = async (id: string, email: string) =>
  (
    await api<{ share: Share }>(`/reminders/${encodeURIComponent(id)}/shares`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  ).share;

export const revokeShare = (reminderId: string, shareId: string) =>
  api<void>(`/reminders/${encodeURIComponent(reminderId)}/shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  });

/**
 * During a rolling deploy the page can briefly talk to a server that predates repeating reminders
 * and sharing: fill those fields in so the UI never has to handle their absence.
 */
const withDefaults = (r: Reminder): Reminder => ({
  ...r,
  recurrence: r.recurrence ?? null,
  sharedWith: r.sharedWith ?? [],
});

export const listReminders = async () =>
  (await api<{ reminders: Reminder[] }>('/reminders')).reminders.map(withDefaults);

export const fetchDueReminders = async (): Promise<DueReminders> => {
  const due = await api<DueReminders>('/reminders/due');
  return { ...due, reminders: due.reminders.map(withDefaults) };
};

export const updateReminder = async (id: string, changes: ReminderChanges) =>
  withDefaults(
    (
      await api<{ reminder: Reminder }>(`/reminders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
    ).reminder,
  );

export const deleteReminder = (id: string) =>
  api<void>(`/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
