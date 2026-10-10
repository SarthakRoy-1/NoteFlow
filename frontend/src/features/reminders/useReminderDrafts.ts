import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../auth/useAuth';
import {
  completeReminderDraft,
  dismissReminderDraft,
  listReminderDrafts,
  type CompleteDraftInput,
} from './draftsApi';
import { REMINDERS_KEY } from './useReminders';

export const DRAFTS_KEY = ['reminder-drafts'] as const;

/** Keyed by account, so one user's pending reminders are never shown to (or reused for) another. */
export function useReminderDrafts() {
  const { data: user } = useMe();
  return useQuery({
    queryKey: [...DRAFTS_KEY, user?.id ?? null],
    queryFn: listReminderDrafts,
    enabled: Boolean(user),
  });
}

function useRefreshAfterChange() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: DRAFTS_KEY }),
      qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
      // A note shows how many reminders came from it and how many still need a time.
      qc.invalidateQueries({ queryKey: ['notes'] }),
    ]);
}

export function useCompleteDraft(id: string) {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (input: CompleteDraftInput) => completeReminderDraft(id, input),
    onSuccess: refresh,
  });
}

export function useDismissDraft(id: string) {
  const refresh = useRefreshAfterChange();
  return useMutation({ mutationFn: () => dismissReminderDraft(id), onSuccess: refresh });
}
