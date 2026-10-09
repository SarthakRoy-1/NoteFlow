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

describe('access', () => {
  it('redirects signed-out visitors from /notes to login', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/notes');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(api.calls('GET', '/api/notes')).toHaveLength(0);
  });

  it('sends / to the notes page and shows the user in the header', async () => {
    new FakeApi();
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Pat Person')).toBeInTheDocument();
  });
});

describe('timestamps use the account timezone', () => {
  it('shows note times in the user’s timezone (Europe/London), not the browser’s', async () => {
    // 23:30 UTC on 1 July is 00:30 on 2 July in London (BST).
    const iso = '2026-07-01T23:30:00.000Z';
    const api = new FakeApi();
    const note = api.add({ title: 'Summer note', createdAt: iso, updatedAt: iso });
    renderAt(`/notes/${note.id}`);
    expect(await screen.findByText(/Updated 2 Jul 2026, 00:30/)).toBeInTheDocument();
    expect(screen.getByText(/Created 2 Jul 2026, 00:30/)).toBeInTheDocument();
    // The list shows the same value.
    expect(
      await screen.findByText('2 Jul 2026, 00:30', { selector: '.note-item-date' }),
    ).toBeInTheDocument();
  });
});

describe('list states', () => {
  it('shows a loading state, then the empty state with a call to action', async () => {
    const api = new FakeApi();
    const release = api.holdNext('GET /api/notes');
    renderAt('/notes');
    expect(await screen.findByText(/loading your notes/i)).toBeInTheDocument();
    release();
    expect(await screen.findByText(/no notes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create your first note/i })).toHaveAttribute(
      'href',
      '/notes/new',
    );
  });

  it('lists notes with titles and previews, newest first', async () => {
    new FakeApi([
      { title: 'Older', content: 'first body' },
      { title: 'Newer', content: 'second body' },
    ]);
    renderAt('/notes');
    const list = await screen.findByRole('list', { name: /your notes/i });
    const items = within(list).getAllByRole('link');
    expect(items[0]).toHaveTextContent('Newer');
    expect(items[0]).toHaveTextContent('second body');
    expect(items[1]).toHaveTextContent('Older');
  });

  it('shows an error with Retry, and recovers when the retry succeeds', async () => {
    const api = new FakeApi([{ title: 'Recovered note' }]);
    api.failNext('GET /api/notes', () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side.'),
    );
    renderAt('/notes');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/something went wrong on our side/i);
    await userEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Recovered note')).toBeInTheDocument();
  });
});

describe('create', () => {
  it('validates empty fields without calling the server', async () => {
    const api = new FakeApi();
    renderAt('/notes/new');
    await userEvent.click(await screen.findByRole('button', { name: /save note/i }));
    expect(screen.getByText(/please enter a title/i)).toBeInTheDocument();
    expect(screen.getByText(/write something in the note/i)).toBeInTheDocument();
    expect(api.calls('POST', '/api/notes')).toHaveLength(0);
  });

  it('rejects whitespace-only text client-side', async () => {
    const api = new FakeApi();
    renderAt('/notes/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Title');
    await userEvent.type(screen.getByLabelText('Note'), '   ');
    await userEvent.click(screen.getByRole('button', { name: /save note/i }));
    expect(screen.getByText(/write something in the note/i)).toBeInTheDocument();
    expect(api.calls('POST', '/api/notes')).toHaveLength(0);
  });

  it('creates a note, shows it, and lists it; the request never carries a user id', async () => {
    const api = new FakeApi();
    renderAt('/notes/new');
    await userEvent.type(await screen.findByLabelText('Title'), '  Groceries ');
    await userEvent.type(screen.getByLabelText('Note'), 'buy milk tomorrow');
    await userEvent.click(screen.getByRole('button', { name: /save note/i }));

    expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(screen.getAllByText('buy milk tomorrow').length).toBeGreaterThan(0);
    const [post] = api.calls('POST', '/api/notes');
    expect(post?.body).toEqual({ title: 'Groceries', content: 'buy milk tomorrow' });
    expect(Object.keys(post?.body as object).sort()).toEqual(['content', 'title']);
    const list = await screen.findByRole('list', { name: /your notes/i });
    expect(within(list).getByText('Groceries')).toBeInTheDocument();
  });

  it('keeps the typed text and shows the server message when saving fails', async () => {
    const api = new FakeApi();
    api.failNext('POST /api/notes', () =>
      apiError(422, 'VALIDATION_FAILED', 'Some of the information you sent is not valid.'),
    );
    renderAt('/notes/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Keep me');
    await userEvent.type(screen.getByLabelText('Note'), 'important text');
    await userEvent.click(screen.getByRole('button', { name: /save note/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i);
    expect(screen.getByLabelText('Title')).toHaveValue('Keep me');
    expect(screen.getByLabelText('Note')).toHaveValue('important text');
    expect(api.notes).toHaveLength(0);
  });

  it('cancel returns to the list without saving', async () => {
    const api = new FakeApi();
    renderAt('/notes/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Draft');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(await screen.findByText(/no notes yet/i)).toBeInTheDocument();
    expect(api.calls('POST', '/api/notes')).toHaveLength(0);
  });
});

describe('view', () => {
  it('opens a note from the list and shows its full content', async () => {
    new FakeApi([{ title: 'Meeting', content: 'line one\nline two' }]);
    renderAt('/notes');
    await userEvent.click(await screen.findByRole('link', { name: /meeting/i }));
    expect(await screen.findByRole('heading', { name: 'Meeting' })).toBeInTheDocument();
    const article = screen.getByRole('article');
    expect(within(article).getByText(/line one/)).toHaveTextContent('line one line two');
  });

  it('renders note text as plain text, never as HTML', async () => {
    new FakeApi([{ title: 'XSS', content: '<img src=x onerror=alert(1)> <b>bold</b>' }]);
    const { container } = renderAt('/notes');
    await userEvent.click(await screen.findByRole('link', { name: /xss/i }));
    await screen.findByRole('heading', { name: 'XSS' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.note-content b')).toBeNull();
    expect(within(screen.getByRole('article')).getByText(/<img src=x/)).toBeInTheDocument();
  });

  it('shows "no longer exists" for a missing note', async () => {
    new FakeApi();
    renderAt('/notes/00000000-0000-4000-8000-0000000000ff');
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/i);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows a loading state while the note loads', async () => {
    const api = new FakeApi([{ title: 'Slow' }]);
    const id = api.notes[0]?.id;
    const release = api.holdNext(`GET /api/notes/${id}`);
    renderAt(`/notes/${id}`);
    expect(await screen.findByText(/loading note/i)).toBeInTheDocument();
    release();
    expect(await screen.findByRole('heading', { name: 'Slow' })).toBeInTheDocument();
  });
});

describe('edit', () => {
  async function openEditor() {
    const api = new FakeApi([{ title: 'Original', content: 'original body' }]);
    renderAt(`/notes/${api.notes[0]?.id}`);
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    return api;
  }

  it('saves changes with a PATCH and shows the updated note and list', async () => {
    const api = await openEditor();
    const title = screen.getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeInTheDocument();
    const [patch] = api.calls('PATCH', `/api/notes/${api.notes[0]?.id}`);
    expect(patch?.body).toEqual({ title: 'Renamed', content: 'original body' });
    const list = await screen.findByRole('list', { name: /your notes/i });
    expect(within(list).getByText('Renamed')).toBeInTheDocument();
  });

  it('validates before sending', async () => {
    const api = await openEditor();
    await userEvent.clear(screen.getByLabelText('Note'));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(screen.getByText(/write something in the note/i)).toBeInTheDocument();
    expect(api.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('cancel discards edits', async () => {
    const api = await openEditor();
    await userEvent.type(screen.getByLabelText('Title'), ' changed');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(await screen.findByRole('heading', { name: 'Original' })).toBeInTheDocument();
    expect(api.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('shows a server error and stays in edit mode', async () => {
    const api = await openEditor();
    api.failNext(`PATCH /api/notes/${api.notes[0]?.id}`, () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.'),
    );
    await userEvent.type(screen.getByLabelText('Title'), '!');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByLabelText('Title')).toHaveValue('Original!');
  });
});

describe('delete', () => {
  async function openNote() {
    const api = new FakeApi([{ title: 'Doomed' }, { title: 'Survivor' }]);
    renderAt(`/notes/${api.notes[0]?.id}`);
    await screen.findByRole('heading', { name: 'Doomed' });
    return api;
  }

  it('asks for confirmation and does nothing when cancelled', async () => {
    const api = await openNote();
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByText(/delete this note permanently/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /keep note/i }));
    expect(screen.queryByText(/delete this note permanently/i)).toBeNull();
    expect(api.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
    expect(api.notes).toHaveLength(2);
  });

  it('deletes after confirmation, returns to the list, and removes the note from it', async () => {
    const api = await openNote();
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    await waitFor(() => expect(api.notes).toHaveLength(1));
    const list = await screen.findByRole('list', { name: /your notes/i });
    expect(within(list).queryByText('Doomed')).toBeNull();
    expect(within(list).getByText('Survivor')).toBeInTheDocument();
    expect(screen.getByText(/select a note to read it/i)).toBeInTheDocument();
  });

  it('shows an error when deletion fails and keeps the note', async () => {
    const api = await openNote();
    api.failNext(`DELETE /api/notes/${api.notes[0]?.id}`, () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.'),
    );
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('heading', { name: 'Doomed' })).toBeInTheDocument();
    expect(api.notes).toHaveLength(2);
  });
});
