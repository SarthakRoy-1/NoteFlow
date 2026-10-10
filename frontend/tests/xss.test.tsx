import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
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

/** Untrusted text from notes, the AI and other users must only ever be shown as text. */
const PAYLOAD = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
const FUTURE = '2099-10-09T16:00:00.000Z';

describe('untrusted text is rendered as text, never as markup', () => {
  it('todo titles and their source note titles', async () => {
    const api = new FakeApi();
    api.addTodo({ title: PAYLOAD, sourceNote: { id: 'n1', title: PAYLOAD } });
    renderAt('/todos');
    const main = await screen.findByRole('main');
    await within(main).findAllByText(PAYLOAD, { exact: false });
    expect(main.querySelector('img')).toBeNull();
    expect(main.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('reminder text, person and source note titles', async () => {
    const api = new FakeApi();
    api.addReminder({
      text: PAYLOAD,
      person: PAYLOAD,
      dueAt: FUTURE,
      sourceNote: { id: 'n1', title: PAYLOAD },
    });
    renderAt('/reminders');
    const main = await screen.findByRole('main');
    await within(main).findAllByText(PAYLOAD, { exact: false });
    expect(main.querySelector('img')).toBeNull();
    expect(main.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('a due reminder in the alert banner', async () => {
    const api = new FakeApi();
    api.addReminder({ text: PAYLOAD, person: PAYLOAD, dueAt: '2020-01-01T00:00:00.000Z' });
    renderAt('/notes');
    const banner = await screen.findByRole('region', { name: 'Reminder alerts' });
    expect(within(banner).getAllByText(PAYLOAD, { exact: false }).length).toBeGreaterThan(0);
    expect(banner.querySelector('img')).toBeNull();
    expect(banner.querySelector('script')).toBeNull();
  });
});
