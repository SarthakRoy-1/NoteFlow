import { ApiError, api } from '../../lib/api';

export interface User {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

/** Returns the signed-in user, or null when there is no valid session. */
export async function fetchMe(): Promise<User | null> {
  try {
    const { user } = await api<{ user: User }>('/me');
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const logout = () => api<void>('/auth/logout', { method: 'POST' });
