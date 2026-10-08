import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { analysisSummary } from '../src/features/notes/AnalysisPanel';
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

describe('analysisSummary', () => {
  const base = { status: 'ok' as const, error: null };
  it.each([
    [0, 0, /nothing in this note/i],
    [1, 0, /AI found 1 todo in this note/],
    [2, 0, /AI found 2 todos in this note/],
    [0, 1, /AI found 1 reminder in this note/],
    [1, 1, /AI found 1 todo and 1 reminder in this note/],
    [3, 2, /AI found 3 todos and 2 reminders in this note/],
  ])('%i todos, %i reminders', (todos, reminders, expected) => {
    expect(analysisSummary({ ...base, todos, reminders })).toMatch(expected);
  });
});

describe('analysis panel on a note', () => {
  it('shows what the AI found', async () => {
    const api = new FakeApi([
      { title: 'Plans', analysis: { status: 'ok', error: null, todos: 1, reminders: 1 } },
    ]);
    renderAt(`/notes/${api.notes[0]?.id}`);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'AI found 1 todo and 1 reminder in this note.',
    );
  });

  it('shows the failure message and no success text when analysis failed', async () => {
    const api = new FakeApi([
      {
        title: 'Plans',
        analysis: {
          status: 'failed',
          error:
            'Your note was saved. The AI service is busy right now. Please retry the analysis in a minute.',
          todos: 0,
          reminders: 0,
        },
      },
    ]);
    renderAt(`/notes/${api.notes[0]?.id}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/your note was saved/i);
    expect(alert).toHaveTextContent(/busy right now/i);
    expect(screen.queryByRole('status')).toBeNull();
    // the note itself is still fully visible
    expect(screen.getByRole('heading', { name: 'Plans' })).toBeInTheDocument();
  });

  it('retry calls the analyze endpoint and replaces the error with the result', async () => {
    const api = new FakeApi([
      {
        title: 'Plans',
        analysis: {
          status: 'failed',
          error: 'Your note was saved. Timed out.',
          todos: 0,
          reminders: 0,
        },
      },
    ]);
    renderAt(`/notes/${api.notes[0]?.id}`);
    await userEvent.click(await screen.findByRole('button', { name: /retry analysis/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('AI found 1 todo in this note.');
    expect(api.calls('POST', `/api/notes/${api.notes[0]?.id}/analyze`)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /retry analysis/i })).toBeNull();
  });

  it('shows a retry error without losing the failure panel', async () => {
    const api = new FakeApi([
      {
        title: 'Plans',
        analysis: {
          status: 'failed',
          error: 'Your note was saved. Timed out.',
          todos: 0,
          reminders: 0,
        },
      },
    ]);
    const path = `POST /api/notes/${api.notes[0]?.id}/analyze`;
    api.failNext(path, () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.'),
    );
    renderAt(`/notes/${api.notes[0]?.id}`);
    await userEvent.click(await screen.findByRole('button', { name: /retry analysis/i }));
    expect(await screen.findByText(/something went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry analysis/i })).toBeEnabled();
  });

  it('offers a retry for a note whose analysis never finished (pending)', async () => {
    const api = new FakeApi([
      { title: 'Plans', analysis: { status: 'pending', error: null, todos: 0, reminders: 0 } },
    ]);
    renderAt(`/notes/${api.notes[0]?.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/has not finished/i);
    expect(screen.getByRole('button', { name: /retry analysis/i })).toBeInTheDocument();
  });
});

describe('saving a note shows its analysis', () => {
  it('after creating, the new note shows the AI summary', async () => {
    const api = new FakeApi();
    api.analysisOnCreate = { status: 'ok', error: null, todos: 1, reminders: 0 };
    renderAt('/notes/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Groceries');
    await userEvent.type(screen.getByLabelText('Note'), 'buy milk tomorrow');
    await userEvent.click(screen.getByRole('button', { name: /save note/i }));
    expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(
      within(await screen.findByRole('status')).getByText(/AI found 1 todo/),
    ).toBeInTheDocument();
  });

  it('when the AI fails the note is still saved and the failure is explained', async () => {
    const api = new FakeApi();
    api.analysisOnCreate = {
      status: 'failed',
      error:
        'Your note was saved. AI analysis is not set up on this server, so no todos or reminders were created.',
      todos: 0,
      reminders: 0,
    };
    renderAt('/notes/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Groceries');
    await userEvent.type(screen.getByLabelText('Note'), 'buy milk');
    await userEvent.click(screen.getByRole('button', { name: /save note/i }));
    expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not set up on this server/i);
    expect(api.notes).toHaveLength(1);
  });
});
