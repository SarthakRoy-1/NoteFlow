import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

afterEach(() => vi.unstubAllGlobals());

describe('auth UI', () => {
  it('sends signed-out visitors from / to the login page', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('login link starts the Google flow and passes the browser timezone', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/login');
    const link = await screen.findByRole('link', { name: /sign in with google/i });
    expect(link.getAttribute('href')).toMatch(/^\/api\/auth\/google\?tz=/);
  });

  it('leads with the headline and one primary sign-in action', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/login');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Write notes the way you think.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('shows the demonstration as a still and plays the tour in place only when pressed', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    const { container } = renderAt('/login');
    await screen.findByRole('link', { name: /sign in with google/i });

    // Resting: a poster (portrait one for narrow screens), no video element, no MP4.
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.tour-stage source')?.getAttribute('srcset')).toBe(
      '/tour/noteflow-tour-vertical.jpg',
    );
    expect(container.querySelector('.tour-stage img')?.getAttribute('src')).toBe(
      '/tour/noteflow-tour.jpg',
    );
    const open = screen.getByRole('button', { name: /watch the 23-second tour/i });
    expect(open).toHaveAccessibleDescription(/remind priya to share the q4 roadmap/i);

    await userEvent.click(open);
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('controls');
    expect(video?.getAttribute('src')).toBe('/tour/noteflow-tour.mp4');
    expect(video?.querySelector('track[kind="captions"]')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /hide the tour/i }));
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: /watch the 23-second tour/i })).toHaveFocus();
  });

  it('uses the dark render in the dark theme and follows a theme change while open', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      const { container } = renderAt('/login');
      await screen.findByRole('link', { name: /sign in with google/i });
      expect(container.querySelector('.tour-stage img')?.getAttribute('src')).toBe(
        '/tour/noteflow-tour-dark.jpg',
      );
      expect(container.querySelector('.tour-stage source')?.getAttribute('srcset')).toBe(
        '/tour/noteflow-tour-vertical-dark.jpg',
      );

      await userEvent.click(screen.getByRole('button', { name: /watch the 23-second tour/i }));
      const video = container.querySelector('video');
      expect(video?.getAttribute('src')).toBe('/tour/noteflow-tour-dark.mp4');

      // Switching theme mid-tour swaps to the other render in the same player.
      document.documentElement.setAttribute('data-theme', 'light');
      await waitFor(() =>
        expect(container.querySelector('video')?.getAttribute('src')).toBe(
          '/tour/noteflow-tour.mp4',
        ),
      );
      expect(container.querySelector('video')).toBe(video);
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('"Remember me" is off by default and adds remember=1 to the sign-in link when ticked', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/login');
    const link = await screen.findByRole('link', { name: /sign in with google/i });
    const box = screen.getByRole('checkbox', { name: /remember me/i });
    expect(box).not.toBeChecked();
    expect(link.getAttribute('href')).not.toContain('remember');
    await userEvent.click(box);
    expect(link.getAttribute('href')).toMatch(/^\/api\/auth\/google\?tz=.+&remember=1$/);
    await userEvent.click(box);
    expect(link.getAttribute('href')).not.toContain('remember');
  });

  it.each([
    ['access_denied', /cancelled/i],
    ['not_configured', /not set up/i],
    ['login_failed', /could not complete sign-in/i],
    ['something_unknown', /sign-in failed/i],
  ])('shows a clear message for ?error=%s', async (code, text) => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt(`/login?error=${code}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('a signed-in visitor on /login is sent to the app', async () => {
    new FakeApi();
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  });

  it('shows an error (not a redirect loop) when the account cannot be loaded', async () => {
    const api = new FakeApi();
    api.failNext('GET /api/me', () => apiError(500, 'INTERNAL', 'x'));
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your account/i);
  });

  it('signs out via POST /api/auth/logout and returns to login', async () => {
    const api = new FakeApi();
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    await waitFor(() => expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1));
  });

  it('a session that expires mid-use sends the user back to login after the next failed load', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/notes');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
  });
});

describe('session expiry while the app is open', () => {
  it('sends the user to sign-in with a clear message when a request returns 401', async () => {
    const api = new FakeApi();
    api.add({ title: 'Private note' });
    api.failNext('GET /api/notes', () =>
      apiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'),
    );
    renderAt('/notes');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/session has ended/i);
    // Nothing from the previous session stays on screen.
    expect(screen.queryByText('Private note')).not.toBeInTheDocument();
  });

  it('also reacts to a 401 on a change (a save after the session ended)', async () => {
    const api = new FakeApi();
    const note = api.add({ title: 'Mine' });
    renderAt(`/notes/${note.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    api.failNext(`DELETE /api/notes/${note.id}`, () =>
      apiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'),
    );
    await userEvent.click(await screen.findByRole('button', { name: /yes, delete/i }));
    expect(
      await screen.findByRole('link', { name: /sign in with google/i }, { timeout: 4000 }),
    ).toBeInTheDocument();
    // Awaited: under a heavily loaded full run the message can land a tick after the link.
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      /session has ended/i,
    );
  });

  it('a normal error does not sign the user out', async () => {
    const api = new FakeApi();
    api.failNext('GET /api/notes', () => apiError(500, 'INTERNAL', 'Server trouble.'));
    renderAt('/notes');
    expect(await screen.findByText(/server trouble/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in with google/i })).not.toBeInTheDocument();
  });
});
