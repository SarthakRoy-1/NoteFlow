import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { DUE_POLL_MS } from '../reminders/useReminders';
import { acknowledgeShared, listShared, removeShared } from './sharedApi';

export const SHARED_KEY = ['shared-reminders'] as const;
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Reminders shared with me. Like the due alerts it is re-checked every 30s, on focus, and exactly
 * when the next one is due. The server decides what is due (it is the clock).
 */
export function useSharedReminders() {
  const query = useQuery({
    queryKey: SHARED_KEY,
    queryFn: listShared,
    refetchInterval: DUE_POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const { refetch } = query;
  const nextDueAt = query.data?.nextDueAt ?? null;

  useEffect(() => {
    if (!nextDueAt) return;
    const delay = new Date(nextDueAt).getTime() - Date.now() + 500;
    if (delay <= 0 || delay > MAX_TIMER_MS) return;
    const timer = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(timer);
  }, [nextDueAt, refetch]);

  return query;
}

export function useAcknowledgeShared(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => acknowledgeShared(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHARED_KEY }),
  });
}

export function useRemoveShared(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => removeShared(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHARED_KEY }),
  });
}
