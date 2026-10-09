import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const zone = () => screen.findByRole('combobox', { name: /your time zone/i });
const save = () => screen.getByRole('button', { name: /save time zone/i });

describe('account time zone', () => {
  it('is reachable from the account name in the header', async () => {
    new FakeApi();
    renderAt('/notes');
    await userEvent.click(await screen.findByRole('link', { name: 'Pat Person' }));
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(await zone()).toHaveValue('Europe/London');
  });

  it('keeps a saved zone selectable even when the browser’s list omits it (it lists Asia/Calcutta, not Asia/Kolkata)', async () => {
    const api = new FakeApi();
    api.me.timezone = 'Asia/Kolkata';
    renderAt('/settings');
    expect(await zone()).toHaveValue('Asia/Kolkata');
  });

  it('can only be saved after a change, then sends exactly the chosen zone', async () => {
    const api = new FakeApi();
    renderAt('/settings');
    await userEvent.selectOptions(await zone(), 'Asia/Calcutta');
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    expect(api.calls('PATCH', '/api/me')[0]?.body).toEqual({ timezone: 'Asia/Calcutta' });
    expect(save()).toBeDisabled();
  });

  it('starts disabled with nothing changed', async () => {
    new FakeApi();
    renderAt('/settings');
    await zone();
    expect(save()).toBeDisabled();
  });

  it('changes how every date is shown, immediately', async () => {
    const api = new FakeApi();
    api.addTodo({
      title: 'Timed todo',
      dueAt: '2026-10-09T16:00:00.000Z',
      dueHasTime: true,
    });
    renderAt('/settings');
    await userEvent.selectOptions(await zone(), 'Asia/Calcutta');
    await userEvent.click(save());
    await screen.findByRole('status');
    await userEvent.click(screen.getByRole('link', { name: 'Todos' }));
    expect(await screen.findByText(/Due Fri, 9 Oct 2026, 21:30/)).toBeInTheDocument();
  });

  it('offers this device’s zone when it differs, and saves it', async () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...original.call(this), timeZone: 'America/New_York' };
    });
    const api = new FakeApi();
    renderAt('/settings');
    await userEvent.click(
      await screen.findByRole('button', { name: /use this device’s \(America\/New_York\)/i }),
    );
    expect(await zone()).toHaveValue('America/New_York');
    await userEvent.click(save());
    await screen.findByRole('status');
    expect(api.calls('PATCH', '/api/me')[0]?.body).toEqual({ timezone: 'America/New_York' });
  });

  it('shows the server’s message and keeps the old zone when saving fails', async () => {
    const api = new FakeApi();
    api.failNext('PATCH /api/me', () =>
      apiError(422, 'VALIDATION_FAILED', 'Timezone must be a valid IANA identifier.'),
    );
    renderAt('/settings');
    await userEvent.selectOptions(await zone(), 'Asia/Calcutta');
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid IANA identifier/i);
    expect(api.me.timezone).toBe('Europe/London');
  });

  it('sends signed-out visitors to sign-in', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/settings');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
  });
});

describe('theme', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to following the device, and shows the signed-in account', async () => {
    new FakeApi();
    renderAt('/settings');
    expect(await screen.findByRole('radio', { name: 'System' })).toBeChecked();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
  });

  it('applies and remembers a chosen theme, and clears it when set back to System', async () => {
    new FakeApi();
    renderAt('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('noteflow-theme')).toBe('dark');

    await userEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem('noteflow-theme')).toBeNull();
  });

  it('still applies the theme when storage is blocked', async () => {
    new FakeApi();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderAt('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Light' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});
