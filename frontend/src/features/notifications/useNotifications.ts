import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNotificationSettings, updateNotificationSettings } from './notificationsApi';

export const NOTIFICATIONS_KEY = ['notifications'] as const;

export function useNotificationSettings() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: fetchNotificationSettings,
    staleTime: 30_000,
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateNotificationSettings,
    onSuccess: (settings) => queryClient.setQueryData(NOTIFICATIONS_KEY, settings),
  });
}
