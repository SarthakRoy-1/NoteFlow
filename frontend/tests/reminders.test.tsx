import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const PAST = '2020-01-01T10:00:00.000Z';
const FUTURE = '2099-10-09T16:00:00.000Z';
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

// Rows are looked up in the page body only: a due reminder also appears in the alert banner.
const row = (text: string) => {
  const li = within(screen.getByRole('main')).getByText(text).closest('li');
  if (!li) throw new Error(`no row for ${text}`);
  return within(li);
};

describe('access and navigation', () => {
  it('sends signed-out visitors to login', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/reminders');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(api.calls('GET', '/api/reminders')).toHaveLength(0);
    expect(api.calls('GET', '/api/reminders/due')).toHaveLength(0);
  });

  it('is reachable from the main navigation and marks the current page', async () => {
    new FakeApi();
    renderAt('/notes');
    await userEvent.click(await screen.findByRole('link', { name: 'Reminders' }));
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reminders' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('list states', () => {
  it('shows loading, then the empty state with a way to create reminders', async () => {
    const api = new FakeApi();
    const release = api.holdNext('GET /api/reminders');
    renderAt('/reminders');
    expect(await screen.findByText(/loading your reminders/i)).toBeInTheDocument();
    release();
    expect(await screen.findByText(/no reminders yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /write a note/i })).toHaveAttribute(
      'href',
      '/notes/new',
    );
  });

  it('shows an error with Retry and recovers', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Recovered reminder', dueAt: FUTURE });
    api.failNext('GET /api/reminders', () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side.'),
    );
    renderAt('/reminders');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/something went wrong on our side/i);
    await userEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Recovered reminder')).toBeInTheDocument();
  });

  it('groups reminders into Due now, Upcoming, No time set and Acknowledged', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Late one', dueAt: PAST });
    api.addReminder({ text: 'Future one', dueAt: FUTURE });
    api.addReminder({ text: 'Undated one', dueAt: null });
    api.addReminder({ text: 'Handled one', dueAt: PAST, status: 'acknowledged' });
    renderAt('/reminders');
    await screen.findByText('Late one');
    for (const [name, text] of [
      ['Due now', 'Late one'],
      ['Upcoming', 'Future one'],
      ['No time set', 'Undated one'],
      ['Acknowledged', 'Handled one'],
    ] as const) {
      expect(within(screen.getByRole('region', { name })).getByText(text)).toBeInTheDocument();
    }
  });

  it('hides sections that have nothing in them', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Only upcoming', dueAt: FUTURE });
    renderAt('/reminders');
    await screen.findByText('Only upcoming');
    expect(screen.getByRole('region', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Due now' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Acknowledged' })).toBeNull();
  });
});

describe('reminder rendering', () => {
  it('shows text, person, AI label and the source note link', async () => {
    const api = new FakeApi();
    api.addReminder({
      text: 'Send the invoice',
      person: 'John',
      dueAt: FUTURE,
      sourceNote: { id: '00000000-0000-4000-8000-0000000000bb', title: 'Invoice note' },
    });
    api.addReminder({ text: 'Plain reminder', createdByAi: false, dueAt: FUTURE });
    renderAt('/reminders');
    await screen.findByText('Send the invoice');
    expect(row('Send the invoice').getByText('For John')).toBeInTheDocument();
    expect(row('Send the invoice').getByText('AI-created')).toBeInTheDocument();
    expect(row('Plain reminder').queryByText('AI-created')).toBeNull();
    expect(row('Plain reminder').queryByText(/^For /)).toBeNull();
    expect(
      row('Send the invoice').getByRole('link', { name: /from note: invoice note/i }),
    ).toHaveAttribute('href', '/notes/00000000-0000-4000-8000-0000000000bb');
  });

  it('shows a date-only reminder as a date with no invented time', async () => {
    const api = new FakeApi();
    // start of Fri 9 Oct 2026 in London (BST) = 8 Oct 23:00Z
    api.addReminder({ text: 'Dated', dueAt: '2099-10-08T23:00:00.000Z', dueHasTime: false });
    renderAt('/reminders');
    await screen.findByText('Dated');
    const due = row('Dated').getByText(/^Due /);
    expect(due).toHaveTextContent('Due Fri, 9 Oct 2099');
    expect(due.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('shows date and time in the user timezone when a time was given', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Timed', dueAt: FUTURE, dueHasTime: true });
    renderAt('/reminders');
    await screen.findByText('Timed');
    // Europe/London in October (BST, UTC+1): 16:00Z -> 17:00 local
    expect(row('Timed').getByText(/^Due /)).toHaveTextContent('Due Fri, 9 Oct 2099, 17:00');
  });

  it('says "No time set" instead of inventing one', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Someday', dueAt: null });
    renderAt('/reminders');
    await screen.findByText('Someday');
    expect(row('Someday').getByText('No time set')).toBeInTheDocument();
    expect(row('Someday').queryByText(/^Due /)).toBeNull();
  });

  it('marks reminders whose time has arrived as due, but not future or acknowledged ones', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Late', dueAt: PAST });
    api.addReminder({ text: 'Future', dueAt: FUTURE });
    api.addReminder({ text: 'Late but handled', dueAt: PAST, status: 'acknowledged' });
    renderAt('/reminders');
    await within(await screen.findByRole('main')).findByText('Late');
    expect(row('Late').getByText(/due now/i)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Late').closest('li')).toHaveClass(
      'reminder-due',
    );
    expect(row('Future').queryByText(/due now/i)).toBeNull();
    expect(row('Late but handled').queryByText(/due now/i)).toBeNull();
    expect(row('Late but handled').getByText('Acknowledged')).toBeInTheDocument();
  });
});

describe('a reminder coming due while the page is open', () => {
  it('moves from Upcoming to Due now at its time, without a reload', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'About to be due', dueAt: inMs(1500) });
    renderAt('/reminders');
    const upcoming = await screen.findByRole('region', { name: 'Upcoming' });
    expect(within(upcoming).getByText('About to be due')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Due now' })).toBeNull();

    // The alert query wakes up exactly at the due time and the page regroups itself.
    const dueNow = await screen.findByRole('region', { name: 'Due now' }, { timeout: 8000 });
    expect(within(dueNow).getByText('About to be due')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Upcoming' })).toBeNull();
  }, 15_000);
});

describe('acknowledging', () => {
  it('"Got it" acknowledges with a PATCH and moves the reminder to Acknowledged', async () => {
    const api = new FakeApi();
    const r = api.addReminder({ text: 'Send invoice', dueAt: FUTURE });
    renderAt('/reminders');
    await userEvent.click(
      await screen.findByRole('button', { name: /acknowledge: send invoice/i }),
    );
    const section = await screen.findByRole('region', { name: 'Acknowledged' });
    expect(within(section).getByText('Send invoice')).toBeInTheDocument();
    expect(api.calls('PATCH', `/api/reminders/${r.id}`)[0]?.body).toEqual({ acknowledged: true });
  });

  it('"Re-open" puts it back to pending', async () => {
    const api = new FakeApi();
    const r = api.addReminder({ text: 'Send invoice', dueAt: FUTURE, status: 'acknowledged' });
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('button', { name: /re-open: send invoice/i }));
    expect(await screen.findByRole('region', { name: 'Upcoming' })).toBeInTheDocument();
    expect(api.calls('PATCH', `/api/reminders/${r.id}`)[0]?.body).toEqual({ acknowledged: false });
  });

  it('shows an error and keeps the old state when acknowledging fails', async () => {
    const api = new FakeApi();
    const r = api.addReminder({ text: 'Send invoice', dueAt: FUTURE });
    api.failNext(`PATCH /api/reminders/${r.id}`, () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.'),
    );
    renderAt('/reminders');
    await userEvent.click(
      await screen.findByRole('button', { name: /acknowledge: send invoice/i }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.queryByRole('region', { name: 'Acknowledged' })).toBeNull();
  });
});

describe('editing', () => {
  async function openEditor(partial = {}) {
    const api = new FakeApi();
    const r = api.addReminder({ text: 'Send invoice', person: 'John', ...partial });
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('button', { name: /edit: send invoice/i }));
    return { api, r };
  }
  const patches = (api: FakeApi, id: string) => api.calls('PATCH', `/api/reminders/${id}`);

  it('pre-fills text, person and the due date/time in the user timezone', async () => {
    await openEditor({ dueAt: FUTURE, dueHasTime: true });
    expect(screen.getByLabelText('Reminder')).toHaveValue('Send invoice');
    expect(screen.getByLabelText(/person/i)).toHaveValue('John');
    expect(screen.getByLabelText('Due date')).toHaveValue('2099-10-09');
    expect(screen.getByLabelText(/due time/i)).toHaveValue('17:00');
  });

  it('leaves the time empty for a date-only reminder', async () => {
    await openEditor({ dueAt: '2099-10-08T23:00:00.000Z', dueHasTime: false });
    expect(screen.getByLabelText('Due date')).toHaveValue('2099-10-09');
    expect(screen.getByLabelText(/due time/i)).toHaveValue('');
  });

  it('sends only the text when only the text changed', async () => {
    const { api, r } = await openEditor();
    const input = screen.getByLabelText('Reminder');
    await userEvent.clear(input);
    await userEvent.type(input, 'Send final invoice');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Send final invoice')).toBeInTheDocument();
    expect(patches(api, r.id)[0]?.body).toEqual({ text: 'Send final invoice' });
  });

  it('changes the person, and clearing it sends null', async () => {
    const { api, r } = await openEditor();
    const person = screen.getByLabelText(/person/i);
    await userEvent.clear(person);
    await userEvent.type(person, 'Anita');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(1));
    expect(patches(api, r.id)[0]?.body).toEqual({ person: 'Anita' });
    expect(await screen.findByText('For Anita')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /edit: send invoice/i }));
    await userEvent.clear(screen.getByLabelText(/person/i));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(2));
    expect(patches(api, r.id)[1]?.body).toEqual({ person: null });
    await waitFor(() => expect(screen.queryByText(/^For /)).toBeNull());
  });

  it('sets a due date with a time, and a date-only due date', async () => {
    const { api, r } = await openEditor();
    await userEvent.type(screen.getByLabelText('Due date'), '2099-05-06');
    await userEvent.type(screen.getByLabelText(/due time/i), '09:30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api, r.id)).toHaveLength(1));
    expect(patches(api, r.id)[0]?.body).toEqual({ due: { date: '2099-05-06', time: '09:30' } });
  });

  it('will not clear the due date: a reminder keeps a date and a time', async () => {
    const { api, r } = await openEditor({ dueAt: FUTURE });
    await userEvent.clear(screen.getByLabelText('Due date'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/needs both a date and a time/i);
    expect(patches(api, r.id)).toHaveLength(0);
  });

  it('will not save a date without a time', async () => {
    const { api, r } = await openEditor({ dueAt: FUTURE });
    await userEvent.clear(screen.getByLabelText(/due time/i));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/needs both a date and a time/i);
    expect(patches(api, r.id)).toHaveLength(0);
  });

  it('validates an empty text without calling the server', async () => {
    const { api, r } = await openEditor();
    await userEvent.clear(screen.getByLabelText('Reminder'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter the reminder text/i);
    expect(patches(api, r.id)).toHaveLength(0);
  });

  it('refuses a time without a date', async () => {
    const { api, r } = await openEditor();
    await userEvent.type(screen.getByLabelText(/due time/i), '09:30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/choose a date/i);
    expect(patches(api, r.id)).toHaveLength(0);
  });

  it('does not call the server when nothing changed, and cancel discards edits', async () => {
    const { api, r } = await openEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByLabelText('Reminder')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /edit: send invoice/i }));
    await userEvent.type(screen.getByLabelText('Reminder'), ' changed');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Send invoice')).toBeInTheDocument();
    expect(patches(api, r.id)).toHaveLength(0);
  });

  it('shows the server error and stays in the editor, keeping what was typed', async () => {
    const { api, r } = await openEditor();
    api.failNext(`PATCH /api/reminders/${r.id}`, () =>
      apiError(422, 'VALIDATION_FAILED', 'Some of the information you sent is not valid.'),
    );
    await userEvent.type(screen.getByLabelText('Reminder'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i);
    expect(screen.getByLabelText('Reminder')).toHaveValue('Send invoice!');
  });

  it('only offers text, person and due fields (no owner, source note or internals)', async () => {
    await openEditor();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.queryByLabelText(/note|user|owner|fingerprint|status/i)).toBeNull();
  });
});

describe('deleting', () => {
  async function renderTwo() {
    const api = new FakeApi();
    const doomed = api.addReminder({ text: 'Doomed', dueAt: FUTURE });
    api.addReminder({ text: 'Survivor', dueAt: FUTURE });
    renderAt('/reminders');
    await screen.findByText('Doomed');
    return { api, doomed };
  }

  it('asks for confirmation and does nothing when cancelled', async () => {
    const { api } = await renderTwo();
    await userEvent.click(screen.getByRole('button', { name: /delete: doomed/i }));
    expect(screen.getByText(/delete this reminder\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /keep reminder/i }));
    expect(screen.queryByText(/delete this reminder\?/i)).toBeNull();
    expect(api.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
  });

  it('deletes after confirmation and removes the row', async () => {
    const { api, doomed } = await renderTwo();
    await userEvent.click(screen.getByRole('button', { name: /delete: doomed/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull());
    expect(screen.getByText('Survivor')).toBeInTheDocument();
    expect(api.calls('DELETE', `/api/reminders/${doomed.id}`)).toHaveLength(1);
  });

  it('shows an error when deletion fails and keeps the reminder', async () => {
    const { api, doomed } = await renderTwo();
    api.failNext(`DELETE /api/reminders/${doomed.id}`, () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.'),
    );
    await userEvent.click(screen.getByRole('button', { name: /delete: doomed/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByText('Doomed')).toBeInTheDocument();
  });

  it('shows the empty state once the last reminder is deleted', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Only one', dueAt: FUTURE });
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('button', { name: /delete: only one/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(await screen.findByText(/no reminders yet/i)).toBeInTheDocument();
  });
});

describe('source note navigation', () => {
  it('opens the source note from a reminder', async () => {
    const api = new FakeApi();
    const note = api.add({ title: 'Invoice note', content: 'remind John to send the invoice' });
    api.addReminder({
      text: 'Send invoice',
      dueAt: FUTURE,
      sourceNote: { id: note.id, title: 'Invoice note' },
    });
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('link', { name: /from note: invoice note/i }));
    expect(await screen.findByRole('heading', { name: 'Invoice note' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('remind John to send the invoice');
  });
});

describe('in-app alerts', () => {
  const banner = () => screen.queryByRole('region', { name: /reminder alerts/i });

  it('shows no banner and no badge when nothing is due', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Later', dueAt: FUTURE });
    api.addReminder({ text: 'No time', dueAt: null });
    renderAt('/notes');
    await screen.findByRole('heading', { name: 'Notes' });
    await waitFor(() => expect(api.calls('GET', '/api/reminders/due')).toHaveLength(1));
    expect(banner()).toBeNull();
    expect(screen.getByRole('link', { name: 'Reminders' })).toHaveTextContent(/^Reminders$/);
  });

  it('shows a banner on any page for a due reminder: text, person, due time and source note', async () => {
    const api = new FakeApi();
    const note = api.add({ title: 'Invoice note' });
    api.addReminder({
      text: 'Send the invoice',
      person: 'John',
      dueAt: PAST,
      dueHasTime: true,
      sourceNote: { id: note.id, title: 'Invoice note' },
    });
    renderAt('/notes');
    const region = await screen.findByRole('region', { name: /reminder alerts/i });
    expect(within(region).getByText('1 reminder is due')).toBeInTheDocument();
    expect(within(region).getByText('Send the invoice')).toBeInTheDocument();
    expect(within(region).getByText('For John')).toBeInTheDocument();
    expect(within(region).getByText(/^Due Wed, 1 Jan 2020, 10:00/)).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: /from note: invoice note/i })).toHaveAttribute(
      'href',
      `/notes/${note.id}`,
    );
  });

  it('shows a badge with the due count on the Reminders link', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'One', dueAt: PAST });
    api.addReminder({ text: 'Two', dueAt: PAST });
    renderAt('/todos');
    const link = await screen.findByRole('link', { name: /reminders/i });
    await waitFor(() => expect(within(link).getByLabelText('2 due')).toHaveTextContent('2'));
  });

  it('shows a date-only alert without an invented time', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Renew visa', dueAt: '2020-01-01T00:00:00.000Z', dueHasTime: false });
    renderAt('/notes');
    const region = await screen.findByRole('region', { name: /reminder alerts/i });
    const text = within(region).getByText(/^Due /).textContent ?? '';
    expect(text).toContain('Wed, 1 Jan 2020');
    expect(text).not.toMatch(/\d{2}:\d{2}/);
  });

  it('"Got it" acknowledges via the API, and the banner and badge go away', async () => {
    const api = new FakeApi();
    const r = api.addReminder({ text: 'Send the invoice', dueAt: PAST });
    renderAt('/notes');
    await userEvent.click(
      await screen.findByRole('button', { name: /acknowledge: send the invoice/i }),
    );
    await waitFor(() => expect(banner()).toBeNull());
    expect(api.calls('PATCH', `/api/reminders/${r.id}`)[0]?.body).toEqual({ acknowledged: true });
    expect(screen.getByRole('link', { name: 'Reminders' })).toHaveTextContent(/^Reminders$/);
  });

  it('keeps showing the alert after a reload until it is acknowledged (no re-popping, no loss)', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Send the invoice', dueAt: PAST });
    const first = renderAt('/notes');
    await screen.findByRole('region', { name: /reminder alerts/i });
    first.unmount();
    renderAt('/notes'); // a fresh page load / second tab
    expect(await screen.findByRole('region', { name: /reminder alerts/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    await waitFor(() => expect(banner()).toBeNull());
    renderAt('/notes');
    await screen.findAllByRole('heading', { name: 'Notes' });
    expect(banner()).toBeNull();
  });

  it('lists at most three alerts and links to the rest', async () => {
    const api = new FakeApi();
    for (let i = 1; i <= 5; i++) api.addReminder({ text: `Due ${i}`, dueAt: PAST });
    renderAt('/notes');
    const region = await screen.findByRole('region', { name: /reminder alerts/i });
    expect(within(region).getByText('5 reminders are due')).toBeInTheDocument();
    expect(within(region).getAllByRole('button', { name: /acknowledge/i })).toHaveLength(3);
    expect(within(region).getByText(/and 2 more/i)).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: /view all reminders/i })).toHaveAttribute(
      'href',
      '/reminders',
    );
  });

  it('does not alert for a reminder with no time', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Someday', dueAt: null });
    renderAt('/reminders');
    await screen.findByText('Someday');
    await waitFor(() => expect(api.calls('GET', '/api/reminders/due').length).toBeGreaterThan(0));
    expect(banner()).toBeNull();
  });

  it('an alert appears on time, without a reload, when a reminder becomes due', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Soon', dueAt: inMs(1200) });
    renderAt('/notes');
    await screen.findByRole('heading', { name: 'Notes' });
    expect(banner()).toBeNull();
    // the client wakes up at nextDueAt (+0.5s) and re-checks with the server
    expect(
      await screen.findByRole('region', { name: /reminder alerts/i }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Soon')).toBeInTheDocument();
    expect(api.calls('GET', '/api/reminders/due').length).toBeGreaterThanOrEqual(2);
  });

  it('re-checks when the tab regains focus', async () => {
    const api = new FakeApi();
    renderAt('/notes');
    await screen.findByRole('heading', { name: 'Notes' });
    await waitFor(() => expect(api.calls('GET', '/api/reminders/due')).toHaveLength(1));
    expect(banner()).toBeNull();
    api.addReminder({ text: 'Became due', dueAt: PAST });
    window.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByRole('region', { name: /reminder alerts/i })).toBeInTheDocument();
  });

  it('stays quiet if the alert check fails, and the rest of the app keeps working', async () => {
    const api = new FakeApi();
    api.failNext('GET /api/reminders/due', () => apiError(500, 'INTERNAL', 'boom'), true);
    renderAt('/notes');
    expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/reminders/due').length).toBeGreaterThan(0));
    expect(banner()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('acknowledging from the banner is reflected on the Reminders page', async () => {
    const api = new FakeApi();
    api.addReminder({ text: 'Send the invoice', dueAt: PAST });
    renderAt('/reminders');
    const region = await screen.findByRole('region', { name: /reminder alerts/i });
    await userEvent.click(within(region).getByRole('button', { name: /acknowledge/i }));
    expect(await screen.findByRole('region', { name: 'Acknowledged' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Due now' })).toBeNull();
  });
});
