import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { analysisSummary } from '../src/features/notes/AnalysisPanel';
import { FakeApi, apiError, type FakeDraft } from './fakeApi';

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

const NOTE = { id: 'note-1', title: 'Invoice' };
const draft = (over: Partial<FakeDraft> = {}): FakeDraft => ({
  id: 'draft-1',
  text: 'Send the invoice',
  person: 'John',
  suggestedDate: '2026-10-09',
  recurrence: null,
  sourceNote: NOTE,
  createdAt: '2026-10-08T10:00:00.000Z',
  ...over,
});

describe('reminders that still need a date and time', () => {
  it('lists them on the Reminders page with the date the note stated and an empty time', async () => {
    const api = new FakeApi();
    api.drafts = [draft()];
    renderAt('/reminders');

    const section = await screen.findByRole('region', { name: /needs a date and time/i });
    expect(within(section).getByText('Send the invoice')).toBeInTheDocument();
    expect(within(section).getByText(/for john/i)).toBeInTheDocument();
    expect(within(section).getByLabelText('Date')).toHaveValue('2026-10-09');
    // The time is never guessed: the field starts empty.
    expect(within(section).getByLabelText(/^time/i)).toHaveValue('');
    expect(screen.getByText(/nothing is guessed/i)).toBeInTheDocument();
  });

  it('will not submit without a time, and sends nothing to the server', async () => {
    const api = new FakeApi();
    api.drafts = [draft()];
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('button', { name: /save reminder/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a time/i);
    expect(api.calls('POST', '/api/reminder-drafts/draft-1/complete')).toHaveLength(0);
  });

  it('will not submit without a date for a one-off reminder', async () => {
    const api = new FakeApi();
    api.drafts = [draft({ suggestedDate: null })];
    renderAt('/reminders');
    await userEvent.type(await screen.findByLabelText(/^time/i), '17:00');
    await userEvent.click(screen.getByRole('button', { name: /save reminder/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a date/i);
    expect(api.calls('POST', '/api/reminder-drafts/draft-1/complete')).toHaveLength(0);
  });

  it('saves the typed date and time, then shows it as a reminder', async () => {
    const api = new FakeApi();
    api.drafts = [draft()];
    renderAt('/reminders');
    await userEvent.type(await screen.findByLabelText(/^time/i), '17:30');
    await userEvent.click(screen.getByRole('button', { name: /save reminder/i }));

    await waitFor(() =>
      expect(screen.queryByText(/needs a date and time/i)).not.toBeInTheDocument(),
    );
    const [post] = api.calls('POST', '/api/reminder-drafts/draft-1/complete');
    expect(post?.body).toEqual({ date: '2026-10-09', time: '17:30' });
    expect(api.reminders.map((r) => r.text)).toEqual(['Send the invoice']);
  });

  it("shows the server's reason when it refuses (for example a time in the past)", async () => {
    const api = new FakeApi();
    api.drafts = [draft()];
    api.failNext('POST /api/reminder-drafts/draft-1/complete', () =>
      apiError(
        422,
        'VALIDATION_FAILED',
        'That time has already passed. Choose a date and time in the future.',
      ),
    );
    renderAt('/reminders');
    await userEvent.type(await screen.findByLabelText(/^time/i), '08:00');
    await userEvent.click(screen.getByRole('button', { name: /save reminder/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already passed/i);
    // Still pending: nothing was saved.
    expect(screen.getByText('Send the invoice')).toBeInTheDocument();
    expect(api.reminders).toHaveLength(0);
  });

  it('a repeating one only asks for the time of day', async () => {
    const api = new FakeApi();
    api.drafts = [
      draft({ text: 'Send the report', suggestedDate: null, recurrence: { days: [1] } }),
    ];
    renderAt('/reminders');
    expect(await screen.findByLabelText(/^time/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^time/i), '09:00');
    await userEvent.click(screen.getByRole('button', { name: /save reminder/i }));
    await waitFor(() =>
      expect(api.calls('POST', '/api/reminder-drafts/draft-1/complete')[0]?.body).toEqual({
        time: '09:00',
      }),
    );
  });

  it('can be dismissed', async () => {
    const api = new FakeApi();
    api.drafts = [draft()];
    renderAt('/reminders');
    await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: /needs a date and time/i }),
      ).not.toBeInTheDocument(),
    );
    expect(api.calls('DELETE', '/api/reminder-drafts/draft-1')).toHaveLength(1);
  });

  it('also appears on the note the reminder came from', async () => {
    const api = new FakeApi();
    api.notes = [
      {
        id: NOTE.id,
        title: NOTE.title,
        content: 'Remind John to send the invoice on Friday',
        createdAt: '2026-10-08T09:00:00.000Z',
        updatedAt: '2026-10-08T09:00:00.000Z',
        analysis: { status: 'ok', error: null, todos: 0, reminders: 0, pendingReminders: 1 },
      },
    ];
    api.drafts = [draft()];
    renderAt('/notes/note-1');
    expect(
      await screen.findByRole('region', { name: /needs a date and time/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/still needs a date and time/i)).toBeInTheDocument();
  });

  it('says nothing when there are no pending reminders', async () => {
    const api = new FakeApi();
    api.drafts = [];
    renderAt('/reminders');
    expect(await screen.findByText(/no reminders yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /needs a date and time/i }),
    ).not.toBeInTheDocument();
  });
});

describe('analysis summary with pending reminders', () => {
  it('mentions what still needs a date and time', () => {
    expect(
      analysisSummary({ status: 'ok', error: null, todos: 1, reminders: 0, pendingReminders: 2 }),
    ).toBe(
      'AI found 1 todo in this note. 2 reminders still need a date and time before it can be saved.',
    );
    expect(
      analysisSummary({ status: 'ok', error: null, todos: 0, reminders: 0, pendingReminders: 1 }),
    ).toBe('1 reminder still needs a date and time before it can be saved.');
    expect(analysisSummary({ status: 'ok', error: null, todos: 0, reminders: 0 })).toBe(
      'AI found nothing in this note to turn into a todo or reminder.',
    );
  });
});
