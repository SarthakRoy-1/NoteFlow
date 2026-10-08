import type { DueInput } from '../../components/DueFields';
import { api } from '../../lib/api';

export const REMINDER_TEXT_MAX = 200;
export const REMINDER_PERSON_MAX = 80;

export interface Reminder {
  id: string;
  text: string;
  /** A person named in the note. Informational only: nobody is notified. */
  person: string | null;
  /** UTC instant, or null when the note gave no date/time (such a reminder never alerts). */
  dueAt: string | null;
  /** false = only a date was given; dueAt is then the start of that local day. */
  dueHasTime: boolean;
  status: 'pending' | 'acknowledged' | 'dismissed';
  acknowledgedAt: string | null;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  sourceNote: { id: string; title: string };
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
  acknowledged?: boolean;
}

export const listReminders = async () =>
  (await api<{ reminders: Reminder[] }>('/reminders')).reminders;

export const fetchDueReminders = () => api<DueReminders>('/reminders/due');

export const updateReminder = async (id: string, changes: ReminderChanges) =>
  (
    await api<{ reminder: Reminder }>(`/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    })
  ).reminder;

export const deleteReminder = (id: string) =>
  api<void>(`/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
