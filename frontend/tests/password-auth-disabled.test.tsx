import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { FakeApi, apiError } from './fakeApi';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function disabled(signedIn = false) {
  const api = new FakeApi();
  api.signedIn = signedIn;
  api.passwordAuthEnabled = false;
  return api;
}

afterEach(() => vi.unstubAllGlobals());

describe('with custom password auth disabled', () => {
  it('shows only Google on the login page', async () => {
    const api = disabled();
    renderAt('/login');
    const google = await screen.findByRole('link', { name: 'Sign in with Google' });
    expect(google.getAttribute('href')).toMatch(/^\/api\/auth\/google\?tz=/);
    await waitFor(() => expect(api.requests.some((r) => r.url === '/api/auth/config')).toBe(true));
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /forgot password/i })).not.toBeInTheDocument();
  });

  it.each(['/verify-email', '/forgot-password', '/reset-password'])(
    '%s sends the visitor to the login page and calls no auth endpoint',
    async (path) => {
      const api = disabled();
      renderAt(path);
      expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument();
      const calls = api.requests.filter(
        (r) => r.url.startsWith('/api/auth/') && r.url !== '/api/auth/config',
      );
      expect(calls).toEqual([]);
    },
  );

  it('hides the sign-in methods / connect-Google panel in settings', async () => {
    disabled(true);
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/you sign in with google/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign-in methods' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
  });

  it('never shows password sign-in while the config is slow or fails', async () => {
    const api = disabled();
    api.passwordAuthEnabled = true; // even if the server would say yes, an unknown answer shows nothing
    const release = api.holdNext('GET /api/auth/config');
    renderAt('/login');
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    release();
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('stays Google-only when the config request fails', async () => {
    const api = disabled();
    api.failNext('GET /api/auth/config', () => apiError(500, 'INTERNAL', 'boom'), true);
    renderAt('/login');
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument();
    await waitFor(() => expect(api.requests.some((r) => r.url === '/api/auth/config')).toBe(true));
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});
