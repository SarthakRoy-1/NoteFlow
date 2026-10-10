import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  deleteReminder,
  fetchDueReminders,
  listReminders,
  revokeShare,
  shareReminder,
  updateReminder,
  type ReminderChanges,
} from './remindersApi';

/** Prefix shared by every reminder query, so one invalidation refreshes list and alerts together. */
export const REMINDERS_KEY = ['reminders'] as const;
const LIST_KEY = [...REMINDERS_KEY, 'list'] as const;
const DUE_KEY = [...REMINDERS_KEY, 'due'] as const;

/** How often the browser re-checks which reminders are due (the server decides; it is the clock). */
export const DUE_POLL_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;

export function useReminders() {
  return useQuery({ queryKey: LIST_KEY, queryFn: listReminders });
}

/**
 * Reminders whose time has arrived. Re-checked every 30s, when the tab regains focus, and exactly
 * when the next reminder is due, so an alert appears on time without any push infrastructure.
 */
export function useDueReminders() {
  const query = useQuery({
    queryKey: DUE_KEY,
    queryFn: fetchDueReminders,
    refetchInterval: DUE_POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const { refetch } = query;
  const nextDueAt = query.data?.nextDueAt ?? null;

  useEffect(() => {
    if (!nextDueAt) return;
    const delay = new Date(nextDueAt).getTime() - Date.now() + 500;
    if (delay <= 0 || delay > MAX_TIMER_MS) return; // the poll covers these cases
    const timer = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(timer);
  }, [nextDueAt, refetch]);

  return query;
}

export function useUpdateReminder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: ReminderChanges) => updateReminder(id, changes),
    onSuccess: () => qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
  });
}

export function useShareReminder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => shareReminder(id, email),
    onSuccess: () => qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
  });
}

export function useRevokeShare(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => revokeShare(id, shareId),
    onSuccess: () => qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
  });
}

export function useDeleteReminder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteReminder(id),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
        // A note shows how many reminders came from it; keep that count honest.
        qc.invalidateQueries({ queryKey: ['notes'] }),
      ]),
  });
}
