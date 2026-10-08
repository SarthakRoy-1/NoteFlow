import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { formatDue, toInputDate, toInputTime } from '../src/lib/time';
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

const row = (title: string) => {
  const li = screen.getByText(title).closest('li');
  if (!li) throw new Error(`no row for ${title}`);
  return within(li);
};

describe('access and navigation', () => {
  it('sends signed-out visitors to login', async () => {
    const api = new FakeApi();
    api.signedIn = false;
    renderAt('/todos');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(api.calls('GET', '/api/todos')).toHaveLength(0);
  });

  it('is reachable from the main navigation and marks the current page', async () => {
    new FakeApi();
    renderAt('/notes');
    await userEvent.click(await screen.findByRole('link', { name: 'Todos' }));
    expect(await screen.findByRole('heading', { name: 'Todos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Todos' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('list states', () => {
  it('shows loading, then the empty state with a way to create todos', async () => {
    const api = new FakeApi();
    const release = api.holdNext('GET /api/todos');
    renderAt('/todos');
    expect(await screen.findByText(/loading your todos/i)).toBeInTheDocument();
    release();
    expect(await screen.findByText(/no todos yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /write a note/i })).toHaveAttribute(
      'href',
      '/notes/new',
    );
  });

  it('shows an error with Retry and recovers', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Recovered todo' });
    api.failNext('GET /api/todos', () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side.'),
    );
    renderAt('/todos');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/something went wrong on our side/i);
    await userEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Recovered todo')).toBeInTheDocument();
  });

  it('renders todos with counts, AI label and the source note link', async () => {
    const api = new FakeApi();
    api.addTodo({
      title: 'Buy milk',
      sourceNote: { id: '00000000-0000-4000-8000-0000000000bb', title: 'Groceries' },
    });
    api.addTodo({ title: 'Call Rahul', createdByAi: false });
    renderAt('/todos');
    expect(await screen.findByText('Buy milk')).toBeInTheDocument();
    expect(screen.getByText('2 open · 0 completed')).toBeInTheDocument();
    expect(row('Buy milk').getByText('AI-created')).toBeInTheDocument();
    expect(row('Call Rahul').queryByText('AI-created')).toBeNull();
    const source = row('Buy milk').getByRole('link', { name: /from note: groceries/i });
    expect(source).toHaveAttribute('href', '/notes/00000000-0000-4000-8000-0000000000bb');
  });
});

describe('due dates', () => {
  it('shows a date-only due date as a date, with no invented time', async () => {
    const api = new FakeApi();
    // end of Fri, 9 Oct 2026 in London (BST) = 22:59:59.999Z
    api.addTodo({ title: 'Dated', dueAt: '2026-10-09T22:59:59.999Z', dueHasTime: false });
    renderAt('/todos');
    await screen.findByText('Dated');
    const due = row('Dated').getByText(/^Due /);
    expect(due).toHaveTextContent('Due Fri, 9 Oct 2026');
    expect(due.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('shows date and time in the user timezone when a time was given', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Timed', dueAt: '2099-10-09T16:00:00.000Z', dueHasTime: true });
    renderAt('/todos');
    await screen.findByText('Timed');
    // Europe/London in October (BST, UTC+1): 16:00Z -> 17:00 local
    expect(row('Timed').getByText(/^Due /)).toHaveTextContent('Due Fri, 9 Oct 2099, 17:00');
  });

  it('flags open todos that are past due, but not completed ones', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Late', dueAt: '2020-01-01T10:00:00.000Z', dueHasTime: true });
    api.addTodo({
      title: 'Late but done',
      dueAt: '2020-01-01T10:00:00.000Z',
      dueHasTime: true,
      completed: true,
    });
    api.addTodo({ title: 'Future', dueAt: '2099-01-01T10:00:00.000Z', dueHasTime: true });
    renderAt('/todos');
    await screen.findByText('Late');
    expect(row('Late').getByText(/overdue/i)).toBeInTheDocument();
    expect(row('Late but done').queryByText(/overdue/i)).toBeNull();
    expect(row('Future').queryByText(/overdue/i)).toBeNull();
  });

  it('shows no due line when there is no due date', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Someday' });
    renderAt('/todos');
    await screen.findByText('Someday');
    expect(row('Someday').queryByText(/^Due /)).toBeNull();
  });
});

describe('completion', () => {
  it('distinguishes completed todos visually and in text', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Open one' });
    api.addTodo({ title: 'Done one', completed: true });
    renderAt('/todos');
    await screen.findByText('Open one');
    const doneRow = screen.getByText('Done one').closest('li');
    expect(doneRow).toHaveClass('todo-done');
    expect(within(doneRow as HTMLElement).getByText('Done')).toBeInTheDocument();
    expect(within(doneRow as HTMLElement).getByRole('checkbox')).toBeChecked();
    const openRow = screen.getByText('Open one').closest('li');
    expect(openRow).not.toHaveClass('todo-done');
    expect(within(openRow as HTMLElement).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('1 open · 1 completed')).toBeInTheDocument();
  });

  it('marks a todo done with a PATCH and updates the page', async () => {
    const api = new FakeApi();
    const t = api.addTodo({ title: 'Buy milk' });
    renderAt('/todos');
    await userEvent.click(await screen.findByRole('checkbox', { name: /mark as done: buy milk/i }));
    expect(await screen.findByText('0 open · 1 completed')).toBeInTheDocument();
    expect(api.calls('PATCH', `/api/todos/${t.id}`)[0]?.body).toEqual({ completed: true });
    expect(row('Buy milk').getByRole('checkbox')).toBeChecked();
  });

  it('marks a done todo as not done again', async () => {
    const api = new FakeApi();
    const t = api.addTodo({ title: 'Buy milk', completed: true });
    renderAt('/todos');
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /mark as not done: buy milk/i }),
    );
    expect(await screen.findByText('1 open · 0 completed')).toBeInTheDocument();
    expect(api.calls('PATCH', `/api/todos/${t.id}`)[0]?.body).toEqual({ completed: false });
  });

  it('shows an error and keeps the old state when toggling fails', async () => {
    const api = new FakeApi();
    const t = api.addTodo({ title: 'Buy milk' });
    api.failNext(`PATCH /api/todos/${t.id}`, () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.'),
    );
    renderAt('/todos');
    await userEvent.click(await screen.findByRole('checkbox', { name: /buy milk/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(row('Buy milk').getByRole('checkbox')).not.toBeChecked();
  });

  it('filters by open and completed', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Open one' });
    api.addTodo({ title: 'Done one', completed: true });
    renderAt('/todos');
    await screen.findByText('Open one');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.queryByText('Done one')).toBeNull();
    expect(screen.getByText('Open one')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.queryByText('Open one')).toBeNull();
    expect(screen.getByText('Done one')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Open one')).toBeInTheDocument();
  });

  it('says so when a filter has nothing to show', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Open one' });
    renderAt('/todos');
    await screen.findByText('Open one');
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.getByText(/no completed todos yet/i)).toBeInTheDocument();
  });
});

describe('editing', () => {
  async function openEditor(partial = {}) {
    const api = new FakeApi();
    const t = api.addTodo({ title: 'Buy milk', ...partial });
    renderAt('/todos');
    await userEvent.click(await screen.findByRole('button', { name: /edit: buy milk/i }));
    return { api, t };
  }

  it('pre-fills the form from the stored values in the user timezone', async () => {
    await openEditor({ dueAt: '2099-10-09T16:00:00.000Z', dueHasTime: true });
    expect(screen.getByLabelText('Todo')).toHaveValue('Buy milk');
    expect(screen.getByLabelText('Due date')).toHaveValue('2099-10-09');
    expect(screen.getByLabelText(/due time/i)).toHaveValue('17:00');
  });

  it('leaves the time empty for a date-only due date', async () => {
    await openEditor({ dueAt: '2099-10-09T22:59:59.999Z', dueHasTime: false });
    expect(screen.getByLabelText('Due date')).toHaveValue('2099-10-09');
    expect(screen.getByLabelText(/due time/i)).toHaveValue('');
  });

  it('sends only the text when only the text changed', async () => {
    const { api, t } = await openEditor();
    const input = screen.getByLabelText('Todo');
    await userEvent.clear(input);
    await userEvent.type(input, 'Buy oat milk');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Buy oat milk')).toBeInTheDocument();
    expect(api.calls('PATCH', `/api/todos/${t.id}`)[0]?.body).toEqual({ title: 'Buy oat milk' });
    expect(screen.queryByLabelText('Todo')).toBeNull();
  });

  it('sets a date-only due date', async () => {
    const { api, t } = await openEditor();
    await userEvent.type(screen.getByLabelText('Due date'), '2099-05-06');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PATCH', `/api/todos/${t.id}`)).toHaveLength(1));
    expect(api.calls('PATCH', `/api/todos/${t.id}`)[0]?.body).toEqual({
      due: { date: '2099-05-06', time: null },
    });
  });

  it('sets a due date with a time', async () => {
    const { api, t } = await openEditor();
    await userEvent.type(screen.getByLabelText('Due date'), '2099-05-06');
    await userEvent.type(screen.getByLabelText(/due time/i), '09:30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PATCH', `/api/todos/${t.id}`)).toHaveLength(1));
    expect(api.calls('PATCH', `/api/todos/${t.id}`)[0]?.body).toEqual({
      due: { date: '2099-05-06', time: '09:30' },
    });
  });

  it('clears the due date', async () => {
    const { api, t } = await openEditor({ dueAt: '2099-10-09T22:59:59.999Z', dueHasTime: false });
    await userEvent.clear(screen.getByLabelText('Due date'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PATCH', `/api/todos/${t.id}`)).toHaveLength(1));
    expect(api.calls('PATCH', `/api/todos/${t.id}`)[0]?.body).toEqual({ due: null });
    await waitFor(() => expect(row('Buy milk').queryByText(/^Due /)).toBeNull());
  });

  it('validates an empty text without calling the server', async () => {
    const { api } = await openEditor();
    await userEvent.clear(screen.getByLabelText('Todo'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter the todo text/i);
    expect(api.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('refuses a time without a date', async () => {
    const { api } = await openEditor();
    await userEvent.type(screen.getByLabelText(/due time/i), '09:30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/choose a date/i);
    expect(api.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('does not call the server when nothing changed', async () => {
    const { api } = await openEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByLabelText('Todo')).toBeNull();
    expect(api.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('cancel discards edits', async () => {
    const { api } = await openEditor();
    await userEvent.type(screen.getByLabelText('Todo'), ' changed');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(api.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('shows the server error and stays in the editor, keeping what was typed', async () => {
    const { api, t } = await openEditor();
    api.failNext(`PATCH /api/todos/${t.id}`, () =>
      apiError(422, 'VALIDATION_FAILED', 'Some of the information you sent is not valid.'),
    );
    await userEvent.type(screen.getByLabelText('Todo'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i);
    expect(screen.getByLabelText('Todo')).toHaveValue('Buy milk!');
  });

  it('does not offer to edit the owner, source note or other internals', async () => {
    await openEditor();
    const labels = screen.getAllByRole('textbox').map((e) => e.getAttribute('id'));
    expect(labels).toHaveLength(1); // only the text field is a textbox
    expect(screen.queryByLabelText(/note|user|owner|fingerprint/i)).toBeNull();
  });
});

describe('deleting', () => {
  async function renderTwo() {
    const api = new FakeApi();
    const doomed = api.addTodo({ title: 'Doomed' });
    api.addTodo({ title: 'Survivor' });
    renderAt('/todos');
    await screen.findByText('Doomed');
    return { api, doomed };
  }

  it('asks for confirmation and does nothing when cancelled', async () => {
    const { api } = await renderTwo();
    await userEvent.click(screen.getByRole('button', { name: /delete: doomed/i }));
    expect(screen.getByText(/delete this todo\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /keep todo/i }));
    expect(screen.queryByText(/delete this todo\?/i)).toBeNull();
    expect(api.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
  });

  it('deletes after confirmation and removes the row', async () => {
    const { api, doomed } = await renderTwo();
    await userEvent.click(screen.getByRole('button', { name: /delete: doomed/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull());
    expect(screen.getByText('Survivor')).toBeInTheDocument();
    expect(api.calls('DELETE', `/api/todos/${doomed.id}`)).toHaveLength(1);
  });

  it('shows an error when deletion fails and keeps the todo', async () => {
    const { api, doomed } = await renderTwo();
    api.failNext(`DELETE /api/todos/${doomed.id}`, () =>
      apiError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.'),
    );
    await userEvent.click(screen.getByRole('button', { name: /delete: doomed/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByText('Doomed')).toBeInTheDocument();
  });

  it('shows the empty state once the last todo is deleted', async () => {
    const api = new FakeApi();
    api.addTodo({ title: 'Only one' });
    renderAt('/todos');
    await userEvent.click(await screen.findByRole('button', { name: /delete: only one/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(await screen.findByText(/no todos yet/i)).toBeInTheDocument();
  });
});

describe('source note navigation', () => {
  it('opens the source note from a todo', async () => {
    const api = new FakeApi();
    const note = api.add({ title: 'Groceries', content: 'buy milk tomorrow' });
    api.addTodo({ title: 'Buy milk', sourceNote: { id: note.id, title: 'Groceries' } });
    renderAt('/todos');
    await userEvent.click(await screen.findByRole('link', { name: /from note: groceries/i }));
    expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('buy milk tomorrow');
  });
});

describe('time helpers', () => {
  it('formatDue shows a date only when there is no time', () => {
    expect(formatDue('2026-10-09T22:59:59.999Z', false, 'Europe/London')).toBe('Fri, 9 Oct 2026');
  });
  it('formatDue shows date and 24h time in the given timezone', () => {
    expect(formatDue('2026-10-09T16:00:00.000Z', true, 'Europe/London')).toBe(
      'Fri, 9 Oct 2026, 17:00',
    );
    expect(formatDue('2026-10-09T16:00:00.000Z', true, 'Asia/Kolkata')).toBe(
      'Fri, 9 Oct 2026, 21:30',
    );
  });
  it('the date shown depends on the timezone, not the browser', () => {
    expect(formatDue('2026-10-09T22:30:00.000Z', false, 'Asia/Kolkata')).toBe('Sat, 10 Oct 2026');
    expect(formatDue('2026-10-09T22:30:00.000Z', false, 'America/Los_Angeles')).toBe(
      'Fri, 9 Oct 2026',
    );
  });
  it('input helpers use the timezone too', () => {
    expect(toInputDate('2026-10-09T22:30:00.000Z', 'Asia/Kolkata')).toBe('2026-10-10');
    expect(toInputTime('2026-10-09T22:30:00.000Z', 'Asia/Kolkata')).toBe('04:00');
  });
});
