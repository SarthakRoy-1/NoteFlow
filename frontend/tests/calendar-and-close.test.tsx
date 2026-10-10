import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { FakeApi } from './fakeApi';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderApp(entries: string[], index?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Google Calendar settings', () => {
  it('explains when the server has no calendar support', async () => {
    const api = new FakeApi();
    api.calendar = { available: false, connected: false, status: null, googleEmail: null };
    renderApp(['/settings']);
    expect(
      await screen.findByText(/google calendar is not set up on this server/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /connect google calendar/i }),
    ).not.toBeInTheDocument();
  });

  it('asks for permission only when the user clicks Connect, then goes to Google', async () => {
    const api = new FakeApi();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderApp(['/settings']);

    const button = await screen.findByRole('button', { name: /^connect google calendar$/i });
    // Nothing was requested just by opening Settings.
    expect(api.calls('POST', '/api/calendar/connect')).toHaveLength(0);
    await userEvent.click(button);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.example.test/calendar-consent'),
    );
  });

  it('shows the connected account and lets the user disconnect', async () => {
    const api = new FakeApi();
    api.calendar = {
      available: true,
      connected: true,
      status: 'connected',
      googleEmail: 'pat@example.com',
    };
    renderApp(['/settings']);
    expect(await screen.findByText(/connected as pat@example.com/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /disconnect google calendar/i }));
    expect(
      await screen.findByRole('button', { name: /^connect google calendar$/i }),
    ).toBeInTheDocument();
    expect(api.calls('POST', '/api/calendar/disconnect')).toHaveLength(1);
  });

  describe('Sync existing reminders', () => {
    const connected = {
      available: true,
      connected: true,
      status: 'connected' as const,
      googleEmail: 'pat@example.com',
    };
    const syncButton = () => screen.findByRole('button', { name: /sync existing reminders/i });

    it('is only offered while connected', async () => {
      const api = new FakeApi();
      api.calendar = { ...connected, connected: false, status: null, googleEmail: null };
      renderApp(['/settings']);
      await screen.findByRole('button', { name: /^connect google calendar$/i });
      expect(
        screen.queryByRole('button', { name: /sync existing reminders/i }),
      ).not.toBeInTheDocument();
    });

    it('does nothing until pressed, then reports what was added', async () => {
      const api = new FakeApi();
      api.calendar = connected;
      api.syncResults = [{ result: 'ok', synced: 3, failed: 0, remaining: 0 }];
      renderApp(['/settings']);
      const button = await syncButton();
      expect(api.calls('POST', '/api/calendar/sync')).toHaveLength(0);
      await userEvent.click(button);
      expect(await screen.findByText(/3 reminders added or updated/i)).toBeInTheDocument();
      expect(api.calls('POST', '/api/calendar/sync')).toHaveLength(1);
    });

    it('keeps asking while batches remain, then stops', async () => {
      const api = new FakeApi();
      api.calendar = connected;
      api.syncResults = [
        { result: 'ok', synced: 25, failed: 0, remaining: 2 },
        { result: 'ok', synced: 2, failed: 0, remaining: 0 },
      ];
      renderApp(['/settings']);
      await userEvent.click(await syncButton());
      expect(await screen.findByText(/27 reminders added or updated/i)).toBeInTheDocument();
      expect(api.calls('POST', '/api/calendar/sync')).toHaveLength(2);
    });

    it('says plainly when some could not be sent, and that they are still saved', async () => {
      const api = new FakeApi();
      api.calendar = connected;
      api.syncResults = [
        { result: 'ok', synced: 2, failed: 1, remaining: 1 },
        { result: 'ok', synced: 0, failed: 1, remaining: 1 },
      ];
      renderApp(['/settings']);
      await userEvent.click(await syncButton());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/2 added or updated/i);
      expect(alert).toHaveTextContent(/1 could not be sent/i);
      expect(alert).toHaveTextContent(/still saved/i);
      expect(api.calls('POST', '/api/calendar/sync')).toHaveLength(2);
    });

    it('asks to reconnect when Google refuses the permission', async () => {
      const api = new FakeApi();
      api.calendar = connected;
      api.syncResults = [{ result: 'needs_reconnect', synced: 0, failed: 0, remaining: 0 }];
      renderApp(['/settings']);
      await userEvent.click(await syncButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(/no longer accepts/i);
    });

    it('says when everything was already up to date', async () => {
      const api = new FakeApi();
      api.calendar = connected;
      renderApp(['/settings']);
      await userEvent.click(await syncButton());
      expect(await screen.findByText(/already up to date/i)).toBeInTheDocument();
    });
  });

  it('asks to reconnect when Google no longer accepts the permission', async () => {
    const api = new FakeApi();
    api.calendar = {
      available: true,
      connected: false,
      status: 'needs_reconnect',
      googleEmail: 'pat@example.com',
    };
    renderApp(['/settings']);
    expect(await screen.findByText(/no longer accepts/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect google calendar/i })).toBeInTheDocument();
  });

  it.each([
    ['connected', /is connected/i],
    ['declined', /was not allowed/i],
    ['mismatch', /not the one you are signed in with/i],
    ['error', /could not connect google calendar/i],
  ])('shows the outcome of the Google round trip (%s)', async (result, message) => {
    new FakeApi();
    renderApp([`/settings?calendar=${result}`]);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

describe('closing Settings', () => {
  it('has a labelled close button that returns to the previous page', async () => {
    new FakeApi();
    renderApp(['/todos', '/settings'], 1);
    await userEvent.click(await screen.findByRole('button', { name: /close settings/i }));
    expect(await screen.findByRole('heading', { name: 'Todos', level: 1 })).toBeInTheDocument();
  });

  it('goes to Notes when Settings was opened directly', async () => {
    new FakeApi();
    renderApp(['/settings']);
    await userEvent.click(await screen.findByRole('button', { name: /close settings/i }));
    expect(await screen.findByRole('heading', { name: 'Notes', level: 1 })).toBeInTheDocument();
  });

  it('is reachable by keyboard and closes with Enter', async () => {
    new FakeApi();
    renderApp(['/reminders', '/settings'], 1);
    const close = await screen.findByRole('button', { name: /close settings/i });
    close.focus();
    expect(close).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Reminders', level: 1 })).toBeInTheDocument();
  });

  it('asks before discarding an unsaved time zone change', async () => {
    const api = new FakeApi();
    renderApp(['/todos', '/settings'], 1);
    const zone = await screen.findByRole('combobox', { name: /your time zone/i });
    await userEvent.selectOptions(zone, 'Asia/Tokyo');
    await userEvent.click(screen.getByRole('button', { name: /close settings/i }));

    const prompt = await screen.findByRole('alertdialog', { name: /unsaved changes/i });
    expect(prompt).toHaveTextContent(/unsaved time zone change/i);
    // Still on Settings, and nothing was saved.
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(api.calls('PATCH', '/api/me')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /your time zone/i })).toHaveValue('Asia/Tokyo');

    await userEvent.click(screen.getByRole('button', { name: /close settings/i }));
    await userEvent.click(await screen.findByRole('button', { name: /discard and close/i }));
    expect(await screen.findByRole('heading', { name: 'Todos', level: 1 })).toBeInTheDocument();
  });

  it('closing does not sign the user out or lose saved preferences', async () => {
    const api = new FakeApi();
    api.notifications.email.enabled = false;
    renderApp(['/notes', '/settings'], 1);
    await userEvent.click(await screen.findByRole('button', { name: /close settings/i }));
    expect(await screen.findByRole('heading', { name: 'Notes', level: 1 })).toBeInTheDocument();
    expect(api.signedIn).toBe(true);
    expect(api.notifications.email.enabled).toBe(false);
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(0);
  });
});
