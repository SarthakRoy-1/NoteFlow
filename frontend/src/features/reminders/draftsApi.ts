import { api } from '../../lib/api';
import type { Reminder } from './remindersApi';

/**
 * A reminder the AI found in a note that still lacks a valid date AND time. It is not a reminder:
 * it never alerts. The user supplies the missing part (the server checks it) or dismisses it.
 */
export interface ReminderDraft {
  id: string;
  text: string;
  person: string | null;
  /** A date the note stated, offered as a prefill ("YYYY-MM-DD", the user's calendar). Never a time. */
  suggestedDate: string | null;
  /** Set for "every Monday"-style drafts: only the time of day is missing. */
  recurrence: { days: number[] } | null;
  sourceNote: { id: string; title: string };
  createdAt: string;
}

export interface CompleteDraftInput {
  /** Required unless the draft repeats on weekdays. */
  date?: string;
  /** Required: "HH:mm" in the user's time zone. */
  time: string;
  text?: string;
  person?: string | null;
}

export const listReminderDrafts = async () =>
  (await api<{ drafts: ReminderDraft[] }>('/reminder-drafts')).drafts;

export const completeReminderDraft = async (id: string, input: CompleteDraftInput) =>
  (
    await api<{ reminder: Reminder }>(`/reminder-drafts/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).reminder;

export const dismissReminderDraft = (id: string) =>
  api<void>(`/reminder-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
