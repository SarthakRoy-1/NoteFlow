import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../auth/useAuth';
import { fetchNotificationSettings, updateNotificationSettings } from './notificationsApi';

/** Prefix for invalidation. The cached value itself is keyed by account (see below). */
export const NOTIFICATIONS_KEY = ['notifications'] as const;

/** Keyed by account so one user's settings are never shown to (or reused for) another. */
export function useNotificationsKey() {
  const { data: user } = useMe();
  return [...NOTIFICATIONS_KEY, user?.id ?? null] as const;
}

export function useNotificationSettings() {
  const queryKey = useNotificationsKey();
  const { data: user } = useMe();
  return useQuery({
    queryKey,
    enabled: Boolean(user),
    queryFn: fetchNotificationSettings,
    staleTime: 30_000,
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  const queryKey = useNotificationsKey();
  return useMutation({
    mutationFn: updateNotificationSettings,
    onSuccess: (settings) => queryClient.setQueryData(queryKey, settings),
  });
}
