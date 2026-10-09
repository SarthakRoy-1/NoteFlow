import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMe,
  fetchAuthConfig,
  loginWithPassword,
  logout,
  updateTimezone,
  verifyEmail,
  type User,
} from './authApi';

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: 60_000 });
}

/** A successful sign-in or sign-up puts the account in the cache, which sends the visitor into the app. */
function useStartSession<TInput>(start: (input: TInput) => Promise<User>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: start,
    onSuccess: (user) => {
      // Drop everything cached for a previous account, but keep the /me query the login page watches.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      queryClient.setQueryData(ME_KEY, user);
    },
  });
}

export const useLogin = () => useStartSession(loginWithPassword);
export const useVerifyEmail = () => useStartSession(verifyEmail);

/** Whether this server can send email (sign-up by email and password reset depend on it). */
export function useAuthConfig() {
  return useQuery({ queryKey: ['auth-config'], queryFn: fetchAuthConfig, staleTime: 5 * 60_000 });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    },
  });
}

/** Saving the zone updates the cached account, so every date on screen re-renders in it at once. */
export function useUpdateTimezone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTimezone,
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });
}
