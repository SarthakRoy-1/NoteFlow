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

const NOTE_ID = '00000000-0000-4000-8000-0000000000aa';
const box = () => screen.findByRole('textbox', { name: /your question/i });
const askButton = () => screen.getByRole('button', { name: /^ask$/i });

async function ask(text: string) {
  await userEvent.type(await box(), text);
  await userEvent.click(askButton());
}

describe('access and navigation', () => {
  it('sends signed-out visitors to login without calling the ask API', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/ask');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(api.calls('GET', '/api/ask/history')).toHaveLength(0);
    expect(api.calls('POST', '/api/ask')).toHaveLength(0);
  });

  it('is reachable from the main navigation and marks the current page', async () => {
    new FakeApi();
    renderAt('/notes');
    await userEvent.click(await screen.findByRole('link', { name: 'Ask AI' }));
    expect(await screen.findByRole('heading', { name: 'Ask AI', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask AI' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('initial state', () => {
  it('shows the question box, an explanation, no answer and an empty history', async () => {
    new FakeApi();
    renderAt('/ask');
    expect(await box()).toHaveValue('');
    expect(screen.getByText(/answers use only your own notes/i)).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Answer' })).not.toBeInTheDocument();
    expect(await screen.findByText(/no questions yet/i)).toBeInTheDocument();
  });
});

describe('validation', () => {
  it('refuses an empty question without calling the API', async () => {
    const api = new FakeApi();
    renderAt('/ask');
    await box();
    await userEvent.click(askButton());
    expect(await screen.findByText('Type a question first.')).toBeInTheDocument();
    expect(await box()).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls('POST', '/api/ask')).toHaveLength(0);
  });

  it('refuses a whitespace-only question', async () => {
    const api = new FakeApi();
    renderAt('/ask');
    await ask('    ');
    expect(await screen.findByText('Type a question first.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/ask')).toHaveLength(0);
  });

  it('refuses an oversized question and shows the limit', async () => {
    const api = new FakeApi();
    renderAt('/ask');
    await userEvent.click(await box());
    await userEvent.paste('a'.repeat(501));
    expect(screen.getByText('501/500')).toBeInTheDocument();
    await userEvent.click(askButton());
    expect(await screen.findByText(/at most 500 characters/i)).toBeInTheDocument();
    expect(api.calls('POST', '/api/ask')).toHaveLength(0);
  });

  it('clears the message once the user types again', async () => {
    new FakeApi();
    renderAt('/ask');
    await box();
    await userEvent.click(askButton());
    await screen.findByText('Type a question first.');
    await userEvent.type(await box(), 'x');
    expect(screen.queryByText('Type a question first.')).not.toBeInTheDocument();
  });
});

describe('asking', () => {
  it('sends only the trimmed question, shows loading, then question, answer and sources', async () => {
    const api = new FakeApi();
    api.add({ id: NOTE_ID, title: 'Berlin trip', content: 'Flights in May' });
    const release = api.holdNext('POST /api/ask');
    renderAt('/ask');
    await ask('  When do I fly to Berlin?  ');

    expect(await screen.findByText(/searching your notes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /asking/i })).toBeDisabled();
    expect(await box()).toBeDisabled();
    release();

    const answer = await screen.findByRole('article', { name: 'Answer' });
    const view = within(answer);
    expect(view.getByText('When do I fly to Berlin?')).toBeInTheDocument();
    expect(view.getByText('You fly to Berlin in May.')).toBeInTheDocument();
    expect(view.getByText('Sources used')).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'Berlin trip' })).toHaveAttribute(
      'href',
      `/notes/${NOTE_ID}`,
    );
    expect(api.calls('POST', '/api/ask')[0]?.body).toEqual({
      question: 'When do I fly to Berlin?',
    });
    // Ready for the next question.
    expect(await box()).toHaveValue('');
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled();
  });

  it('refreshes the history with the new question', async () => {
    const api = new FakeApi();
    renderAt('/ask');
    await screen.findByText(/no questions yet/i);
    await ask('Berlin?');
    const history = await screen.findByRole('region', { name: 'Ask history' });
    expect(await within(history).findByRole('button', { name: /Berlin\?/ })).toBeInTheDocument();
    expect(api.calls('GET', '/api/ask/history').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/no questions yet/i)).not.toBeInTheDocument();
  });

  it('opens the source note when its link is clicked', async () => {
    const api = new FakeApi();
    api.add({ id: NOTE_ID, title: 'Berlin trip', content: 'Flights in May' });
    renderAt('/ask');
    await ask('Berlin?');
    await userEvent.click(await screen.findByRole('link', { name: 'Berlin trip' }));
    expect(await screen.findByRole('heading', { name: 'Berlin trip' })).toBeInTheDocument();
    expect(
      within(await screen.findByRole('article')).getByText('Flights in May'),
    ).toBeInTheDocument();
  });

  it('lists several sources in order', async () => {
    const api = new FakeApi();
    api.askResult = {
      answer: 'Both.',
      status: 'answered',
      sources: [
        { noteId: 'n-1', title: 'First note' },
        { noteId: 'n-2', title: 'Second note' },
      ],
    };
    renderAt('/ask');
    await ask('both?');
    const list = within(await screen.findByRole('article', { name: 'Answer' })).getByRole('list');
    expect(
      within(list)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['First note', 'Second note']);
  });

  it('shows a deleted source as plain text, not a broken link', async () => {
    const api = new FakeApi();
    api.askResult = {
      answer: 'It was in a note.',
      status: 'answered',
      sources: [{ noteId: null, title: 'Gone note' }],
    };
    renderAt('/ask');
    await ask('what?');
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(within(answer).getByText('Gone note')).toBeInTheDocument();
    expect(within(answer).getByText('(note deleted)')).toBeInTheDocument();
    expect(within(answer).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says plainly when the notes do not contain enough information', async () => {
    const api = new FakeApi();
    api.askResult = {
      answer: 'Your saved notes do not contain enough information to answer this question.',
      status: 'no_info',
      sources: [],
    };
    renderAt('/ask');
    await ask('quantum?');
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(within(answer).getByText(/not enough information in your notes/i)).toBeInTheDocument();
    expect(within(answer).getByText(/do not contain enough information/i)).toBeInTheDocument();
    expect(within(answer).getByText(/no notes were used/i)).toBeInTheDocument();
  });

  it('keeps answers read-only', async () => {
    new FakeApi();
    renderAt('/ask');
    await ask('Berlin?');
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(within(answer).queryByRole('button')).not.toBeInTheDocument();
    expect(within(answer).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders the answer as text, never as HTML', async () => {
    const api = new FakeApi();
    api.askResult = {
      answer: '<img src=x onerror=alert(1)><b>bold</b>',
      status: 'answered',
      sources: [],
    };
    renderAt('/ask');
    await ask('xss?');
    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(answer.querySelector('img')).toBeNull();
    expect(answer.querySelector('b')).toBeNull();
    expect(within(answer).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });
});

describe('errors', () => {
  it('shows the server’s message, keeps the question and allows a retry', async () => {
    const api = new FakeApi();
    api.failNext('POST /api/ask', () =>
      apiError(503, 'AI_NOT_CONFIGURED', 'Ask AI is not set up on this server yet.'),
    );
    renderAt('/ask');
    await ask('Berlin?');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask AI is not set up');
    expect(await box()).toHaveValue('Berlin?');
    expect(screen.queryByRole('article', { name: 'Answer' })).not.toBeInTheDocument();

    await userEvent.click(askButton());
    expect(await screen.findByRole('article', { name: 'Answer' })).toBeInTheDocument();
    expect(screen.queryByText(/not set up/i)).not.toBeInTheDocument();
    expect(api.calls('POST', '/api/ask')).toHaveLength(2);
  });

  it.each([
    [429, 'AI_RATE_LIMITED', 'The AI service is busy right now. Please try again in a minute.'],
    [504, 'AI_TIMEOUT', 'The AI service took too long to respond. Please try again.'],
    [502, 'AI_BAD_OUTPUT', 'The AI service returned an unusable answer. Please try again.'],
  ])('shows a %i %s error clearly', async (status, code, message) => {
    const api = new FakeApi();
    api.failNext('POST /api/ask', () => apiError(status, code, message));
    renderAt('/ask');
    await ask('Berlin?');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('explains a network failure', async () => {
    const api = new FakeApi();
    api.failNext('POST /api/ask', () => {
      throw new TypeError('Failed to fetch');
    });
    renderAt('/ask');
    await ask('Berlin?');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  it('does not add a history entry for a failed question', async () => {
    const api = new FakeApi();
    api.failNext('POST /api/ask', () => apiError(502, 'AI_UNAVAILABLE', 'Unavailable.'));
    renderAt('/ask');
    await ask('Berlin?');
    await screen.findByRole('alert');
    const history = screen.getByRole('region', { name: 'Ask history' });
    expect(within(history).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('history', () => {
  it('shows loading, then each entry newest first with date and source count', async () => {
    const api = new FakeApi();
    api.addAsk({
      question: 'Older question',
      createdAt: '2026-10-08T23:30:00.000Z',
      sources: [{ noteId: 'n1', title: 'A' }],
    });
    api.addAsk({ question: 'Newer question', createdAt: '2026-10-10T09:00:00.000Z', sources: [] });
    const release = api.holdNext('GET /api/ask/history');
    renderAt('/ask');
    expect(await screen.findByText(/loading your history/i)).toBeInTheDocument();
    release();

    const history = await screen.findByRole('region', { name: 'Ask history' });
    const items = await within(history).findAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      'Newer question10 Oct 2026, 10:00 · 0 sources',
      // 23:30 UTC is 00:30 the next day in the user's timezone (Europe/London, BST).
      'Older question9 Oct 2026, 00:30 · 1 source',
    ]);
  });

  it('shows a previous answer with its sources when selected, without calling the API', async () => {
    const api = new FakeApi();
    api.addAsk({
      question: 'Where is the passport?',
      answer: 'In the top drawer.',
      sources: [{ noteId: NOTE_ID, title: 'Home notes' }],
    });
    api.addAsk({ question: 'Other', answer: 'Something else.' });
    renderAt('/ask');
    const history = await screen.findByRole('region', { name: 'Ask history' });
    const before = api.requests.length;
    await userEvent.click(await within(history).findByRole('button', { name: /passport/ }));

    const answer = await screen.findByRole('article', { name: 'Answer' });
    expect(within(answer).getByText('Where is the passport?')).toBeInTheDocument();
    expect(within(answer).getByText('In the top drawer.')).toBeInTheDocument();
    expect(within(answer).getByRole('link', { name: 'Home notes' })).toHaveAttribute(
      'href',
      `/notes/${NOTE_ID}`,
    );
    expect(within(history).getByRole('button', { name: /passport/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(history).getByRole('button', { name: /Other/ })).not.toHaveAttribute(
      'aria-current',
    );
    expect(api.requests.length).toBe(before);

    await userEvent.click(within(history).getByRole('button', { name: /Other/ }));
    expect(await screen.findByText('Something else.')).toBeInTheDocument();
    expect(screen.queryByText('In the top drawer.')).not.toBeInTheDocument();
  });

  it('reflects server history after a reload', async () => {
    const api = new FakeApi();
    api.addAsk({ question: 'Saved earlier' });
    const first = renderAt('/ask');
    expect(await screen.findByRole('button', { name: /Saved earlier/ })).toBeInTheDocument();
    first.unmount();
    renderAt('/ask');
    expect(await screen.findByRole('button', { name: /Saved earlier/ })).toBeInTheDocument();
  });

  it('shows an error with a working retry when history cannot be loaded', async () => {
    const api = new FakeApi();
    api.addAsk({ question: 'Saved earlier' });
    api.failNext('GET /api/ask/history', () => apiError(500, 'INTERNAL', 'Server trouble.'));
    renderAt('/ask');
    const history = await screen.findByRole('region', { name: 'Ask history' });
    expect(await within(history).findByRole('alert')).toHaveTextContent('Server trouble.');
    // The question box still works while history is unavailable.
    expect(await box()).toBeEnabled();
    await userEvent.click(within(history).getByRole('button', { name: 'Retry' }));
    expect(await within(history).findByRole('button', { name: /Saved earlier/ })).toBeVisible();
    await waitFor(() => expect(within(history).queryByRole('alert')).not.toBeInTheDocument());
  });

  it('does not offer to edit or delete history', async () => {
    const api = new FakeApi();
    api.addAsk({ question: 'Saved earlier' });
    renderAt('/ask');
    await screen.findByRole('button', { name: /Saved earlier/ });
    expect(screen.queryByRole('button', { name: /delete|edit|remove/i })).not.toBeInTheDocument();
  });
});
