import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Reads the one-time token from the URL fragment (`#token=…`) and then removes it from the address
 * bar, so it does not linger in history. Fragments are never sent to servers or in Referer headers.
 */
export function useUrlToken(): string | null {
  const { hash, pathname } = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(hash.replace(/^#/, '')).get('token'));

  useEffect(() => {
    if (hash) navigate(pathname, { replace: true });
  }, [hash, pathname, navigate]);

  return token;
}
