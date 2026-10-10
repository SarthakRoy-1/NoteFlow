import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { describeRecurrence } from '../src/lib/recurrence';
import { FakeApi } from './fakeApi';

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

const PAST = '2020-01-06T09:30:00.000Z'; // a Monday
const FUTURE = '2099-10-12T09:30:00.000Z';

const main = () => within(screen.getByRole('main'));
const row = (text: string) => {
  const li = main().getByText(text).closest('li');
  if (!li) throw new Error(`no row for ${text}`);
  return within(li);
};
const patches = (api: FakeApi, id: string) => api.calls('PATCH', `/api/reminders/${id}`);

describe('describeRecurrence', () => {
  it.each([
    [{ days: [1], time: '09:00' }, 'Every Monday at 09:00'],
    [{ days: [1, 4], time: null }, 'Every Monday and Thursday'],
    [{ days: [1, 3, 5], time: '07:30' }, 'Every Monday, Wednesday and Friday at 07:30'],
    [{ days: [1, 2, 3, 4, 5], time: '09:00' }, 'Every weekday at 09:00'],
    [{ days: [1, 2, 3, 4, 5, 6, 7], time: null }, 'Every day'],
    [{ days: [7, 7, 6], time: null }, 'Every Saturday and Sunday'],
  ])('%j -> %s', (recurrence, expected) => {
    expect(describeRecurrence(recurrence)).toBe(expected);
  });
});

describe('repeating reminders', () => {
  it('shows how often it repeats', async () => {
    const api = new FakeApi();
    api.addReminder({
      text: 'Send the report',
      dueAt: FUTURE,
      recurrence: { days: [1], time: '09:30' },
    });
    renderAt('/reminders');
    await screen.findByText('Send the report');
    expect(row('Send the report').getByText('Every Monday at 09:30')).toBeInTheDocument();
  });

  it('offers "Got it" only once an occurrence is due', async () => {
    const api = new FakeApi();
    api.addReminder({
      text: 'Later report',
      dueAt: FUTURE,
      recurrence: { days: [1], time: '09:30' },
    });
    api.addReminder({
      text: 'Due report',
      dueAt: PAST,
      recurrence: { days: [1], time: '09:30' },
    });
    renderAt('/reminders');
    await screen.findByText('Later report');
    expect(row('Later report').queryByRole('button', { name: /acknowledge/i })).toBeNull();
    expect(row('Due report').getByRole('button', { name: /acknowledge/i })).toBeInTheDocument();
  });

  it('"Got it" moves a due repeating reminder to its next occurrence instead of closing it', async () => {
    const api = new FakeApi();
    const r = api.addReminder({
      text: 'Due report',
      dueAt: PAST,
      recurrence: { days: [1], time: '09:30' },
    });
    renderAt('/reminders');
    const page = await screen.findByRole('main');
    await userEvent.click(
      await within(page).findByRole('button', { name: /acknowledge: due report/i }),
    );
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(1));
    expect(patches(api, r.id)[0]?.body).toEqual({ acknowledged: true });
    // It is still an active reminder (upcoming), not moved to "Acknowledged".
    expect(await screen.findByRole('region', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Acknowledged' })).toBeNull();
  });
});

describe('choosing how a reminder repeats', () => {
  async function openEditor(partial = {}) {
    const api = new FakeApi();
    const r = api.addReminder({
      text: 'Send invoice',
      dueAt: FUTURE,
      dueHasTime: true,
      ...partial,
    });
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('button', { name: /edit: send invoice/i }));
    return { api, r };
  }

  it('sends only the chosen days', async () => {
    const { api, r } = await openEditor();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mon' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Wed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(1));
    expect(patches(api, r.id)[0]?.body).toEqual({ recurrence: { days: [1, 3] } });
    expect(await screen.findByText('Every Monday and Wednesday at 09:30')).toBeInTheDocument();
  });

  it('has quick choices for every day and weekdays', async () => {
    const { api, r } = await openEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Weekdays' }));
    for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
    }
    expect(screen.getByRole('checkbox', { name: 'Sat' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Every day' }));
    expect(screen.getByRole('checkbox', { name: 'Sun' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(1));
    expect(patches(api, r.id)[0]?.body).toEqual({ recurrence: { days: [1, 2, 3, 4, 5, 6, 7] } });
  });

  it('pre-selects the current days and "Does not repeat" stops it with null', async () => {
    const { api, r } = await openEditor({ recurrence: { days: [2, 4], time: '09:30' } });
    expect(screen.getByRole('checkbox', { name: 'Tue' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Thu' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mon' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Does not repeat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(1));
    expect(patches(api, r.id)[0]?.body).toEqual({ recurrence: null });
  });

  it('sends nothing for the schedule when the days were not touched', async () => {
    const { api, r } = await openEditor({ recurrence: { days: [1], time: '09:30' } });
    const input = screen.getByLabelText('Reminder');
    await userEvent.clear(input);
    await userEvent.type(input, 'Send final invoice');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(1));
    expect(patches(api, r.id)[0]?.body).toEqual({ text: 'Send final invoice' });
  });
});

describe('notifying another user', () => {
  async function openSharePanel(partial = {}) {
    const api = new FakeApi();
    const r = api.addReminder({ text: 'Send invoice', dueAt: FUTURE, ...partial });
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('button', { name: /share: send invoice/i }));
    return { api, r };
  }

  it('shares by account email and shows who it was shared with', async () => {
    const { api, r } = await openSharePanel();
    await userEvent.type(screen.getByLabelText(/account email/i), 'bee@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByText(/shared with bee\./i)).toBeInTheDocument();
    expect(api.calls('POST', `/api/reminders/${r.id}/shares`)[0]?.body).toEqual({
      email: 'bee@example.com',
    });
    // The recipient is listed and the row is badged.
    const list = await screen.findByRole('list', { name: 'Shared with' });
    expect(within(list).getByText('bee')).toBeInTheDocument();
    expect(within(list).getByText('(bee@example.com)')).toBeInTheDocument();
    expect(row('Send invoice').getByText('Shared with 1')).toBeInTheDocument();
  });

  it('never sends a name or an id, only the email', async () => {
    const { api, r } = await openSharePanel({ person: 'John' });
    await userEvent.type(screen.getByLabelText(/account email/i), 'bee@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByText(/shared with bee\./i);
    expect(
      Object.keys(api.calls('POST', `/api/reminders/${r.id}/shares`)[0]?.body as object),
    ).toEqual(['email']);
  });

  it('explains an unknown account', async () => {
    const { api } = await openSharePanel();
    await userEvent.type(screen.getByLabelText(/account email/i), 'unknown@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not find a noteflow account for that email/i,
    );
    expect(screen.queryByText(/^shared with unknown/i)).toBeNull();
    expect(api.reminders[0]?.sharedWith).toEqual([]);
  });

  it('explains sharing with yourself', async () => {
    await openSharePanel();
    await userEvent.type(screen.getByLabelText(/account email/i), 'pat@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/your own account/i);
  });

  it.each([
    ['', /enter the email address/i],
    ['not-an-email', /valid email address/i],
    ['Bee', /valid email address/i],
  ])('checks %j before sending anything', async (value, message) => {
    const { api, r } = await openSharePanel();
    if (value) await userEvent.type(screen.getByLabelText(/account email/i), value);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(api.calls('POST', `/api/reminders/${r.id}/shares`)).toHaveLength(0);
  });

  it('stops sharing with one person', async () => {
    const { api, r } = await openSharePanel({
      sharedWith: [
        { shareId: '50000000-0000-4000-8000-000000000001', name: 'bee', email: 'bee@example.com' },
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: /stop sharing with bee/i }));
    await waitFor(() =>
      expect(
        api.calls('DELETE', `/api/reminders/${r.id}/shares/50000000-0000-4000-8000-000000000001`),
      ).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Shared with' })).toBeNull());
    expect(row('Send invoice').queryByText(/^Shared with \d/)).toBeNull();
  });
});

describe('an older server (rolling deploy)', () => {
  it('still renders reminders that have no recurrence or sharedWith fields', async () => {
    const api = new FakeApi();
    const legacy = {
      id: '20000000-0000-4000-8000-0000000000ff',
      text: 'Legacy reminder',
      person: null,
      dueAt: FUTURE,
      dueHasTime: true,
      status: 'pending',
      acknowledgedAt: null,
      createdByAi: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sourceNote: { id: '00000000-0000-4000-8000-0000000000aa', title: 'Source note' },
    };
    const reply = () =>
      new Response(JSON.stringify({ reminders: [legacy] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    api.failNext('GET /api/reminders', reply, true);
    api.failNext(
      'GET /api/shared-reminders',
      () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), {
          status: 404,
        }),
      true,
    );
    renderAt('/reminders');
    expect(await screen.findByText('Legacy reminder')).toBeInTheDocument();
    expect(row('Legacy reminder').queryByText(/^Shared with \d/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Shared with you' })).toBeNull();
    // The share panel opens without the old server having sent a recipient list.
    await userEvent.click(screen.getByRole('button', { name: /share: legacy reminder/i }));
    expect(screen.getByLabelText(/account email/i)).toBeInTheDocument();
  });
});

describe('reminders shared with me', () => {
  it('stays out of the way when nobody shared anything', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Mine', dueAt: FUTURE });
    renderAt('/reminders');
    await screen.findByText('Mine');
    expect(screen.queryByRole('region', { name: 'Shared with you' })).toBeNull();
  });

  it('lists them with who sent them, and only what was shared', async () => {
    const api = new FakeApi();
    api.addShared({ text: 'Water the plants', dueAt: FUTURE, from: { name: 'Sam Sender' } });
    renderAt('/reminders');
    const section = await screen.findByRole('region', { name: 'Shared with you' });
    expect(within(section).getByText('Water the plants')).toBeInTheDocument();
    expect(within(section).getByText('From Sam Sender')).toBeInTheDocument();
    expect(within(section).getByText('New')).toBeInTheDocument();
    // Nothing about the sender's note: a recipient has no link to it.
    expect(within(section).queryByText(/from note/i)).toBeNull();
    expect(within(section).queryByRole('link')).toBeNull();
  });

  it('shows how often a shared reminder repeats', async () => {
    const api = new FakeApi();
    api.addShared({
      text: 'Stand-up',
      dueAt: FUTURE,
      recurrence: { days: [1, 2, 3, 4, 5], time: '09:30' },
    });
    renderAt('/reminders');
    const section = await screen.findByRole('region', { name: 'Shared with you' });
    expect(within(section).getByText('Every weekday at 09:30')).toBeInTheDocument();
    expect(within(section).getByText(/^Next /)).toBeInTheDocument();
  });

  it('acknowledges a new share', async () => {
    const api = new FakeApi();
    const s = api.addShared({ text: 'Water the plants', dueAt: FUTURE });
    renderAt('/reminders');
    await userEvent.click(
      await screen.findByRole('button', { name: /acknowledge shared reminder: water the plants/i }),
    );
    await waitFor(() =>
      expect(api.calls('PATCH', `/api/shared-reminders/${s.id}`)).toHaveLength(1),
    );
    expect(api.calls('PATCH', `/api/shared-reminders/${s.id}`)[0]?.body).toEqual({
      acknowledged: true,
    });
    await waitFor(() => expect(screen.queryByText('New')).toBeNull());
  });

  it('removes a share from my own list', async () => {
    const api = new FakeApi();
    const s = api.addShared({ text: 'Water the plants', dueAt: FUTURE });
    renderAt('/reminders');
    await userEvent.click(
      await screen.findByRole('button', { name: /remove shared reminder: water the plants/i }),
    );
    await waitFor(() =>
      expect(api.calls('DELETE', `/api/shared-reminders/${s.id}`)).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Shared with you' })).toBeNull(),
    );
  });

  it('raises the in-app alert and the badge when a shared reminder is due', async () => {
    const api = new FakeApi();
    api.addShared({
      text: 'Call the supplier',
      dueAt: PAST,
      due: true,
      occurrenceAt: PAST,
      from: { name: 'Sam Sender' },
    });
    renderAt('/notes');
    const banner = await screen.findByRole('region', { name: 'Reminder alerts' });
    expect(within(banner).getByText('Call the supplier')).toBeInTheDocument();
    expect(within(banner).getByText('Shared by Sam Sender')).toBeInTheDocument();
    expect(screen.getByLabelText('1 due')).toBeInTheDocument();

    await userEvent.click(
      within(banner).getByRole('button', { name: /acknowledge shared reminder/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Reminder alerts' })).toBeNull(),
    );
  });

  it('does not alert for a shared reminder that is not due', async () => {
    const api = new FakeApi();
    api.addShared({ text: 'Later one', dueAt: FUTURE, due: false });
    renderAt('/notes');
    await screen.findByRole('link', { name: /reminders/i });
    expect(screen.queryByRole('region', { name: 'Reminder alerts' })).toBeNull();
  });

  it('renders shared text as text, never as markup', async () => {
    const api = new FakeApi();
    api.addShared({
      text: '<img src=x onerror=alert(1)> <b>bold</b>',
      from: { name: '<script>alert(2)</script>' },
      dueAt: FUTURE,
    });
    renderAt('/reminders');
    const section = await screen.findByRole('region', { name: 'Shared with you' });
    expect(within(section).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(within(section).getByText('From <script>alert(2)</script>')).toBeInTheDocument();
    expect(section.querySelector('img')).toBeNull();
    expect(section.querySelector('script')).toBeNull();
    expect(section.querySelector('b')).toBeNull();
  });
});
