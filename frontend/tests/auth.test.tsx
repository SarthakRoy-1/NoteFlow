import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';

const user = { id: 'u1', email: 'pat@example.com', name: 'Pat', timezone: 'Europe/London' };

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unauthenticated = () =>
  json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } }, 401);

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

afterEach(() => vi.unstubAllGlobals());

describe('auth UI', () => {
  it('sends signed-out visitors from / to the login page', async () => {
    mockFetch(() => unauthenticated());
    renderAt('/');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('login link starts the Google flow and passes the browser timezone', async () => {
    mockFetch(() => unauthenticated());
    renderAt('/login');
    const link = await screen.findByRole('link', { name: /sign in with google/i });
    expect(link.getAttribute('href')).toMatch(/^\/api\/auth\/google\?tz=/);
  });

  it.each([
    ['access_denied', /cancelled/i],
    ['not_configured', /not set up/i],
    ['login_failed', /could not complete sign-in/i],
    ['something_unknown', /sign-in failed/i],
  ])('shows a clear message for ?error=%s', async (code, text) => {
    mockFetch(() => unauthenticated());
    renderAt(`/login?error=${code}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('shows the signed-in user on /', async () => {
    mockFetch(() => json({ user }));
    renderAt('/');
    expect(await screen.findByText(/pat@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/Europe\/London/)).toBeInTheDocument();
  });

  it('shows an error (not a redirect loop) when the account cannot be loaded', async () => {
    mockFetch(() => json({ error: { code: 'INTERNAL', message: 'x' } }, 500));
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your account/i);
  });

  it('signs out via POST /api/auth/logout and returns to login', async () => {
    let signedIn = true;
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/auth/logout' && init?.method === 'POST') {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      return signedIn ? json({ user }) : unauthenticated();
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
