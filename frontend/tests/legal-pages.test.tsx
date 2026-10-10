import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { CONTACT_EMAIL } from '../src/features/legal/legalInfo';
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const signedOut = () => {
  const api = new FakeApi();
  api.signedIn = false;
  return api;
};

describe('public legal pages', () => {
  it.each([
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
  ])('%s opens directly without signing in and makes no API call', async (path, title) => {
    const api = signedOut();
    renderAt(path);
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    // Not bounced to sign-in, and nothing was fetched: it works even if the server is down.
    expect(screen.queryByRole('link', { name: /sign in with google/i })).not.toBeInTheDocument();
    expect(api.requests).toHaveLength(0);
    expect(document.title).toBe(`${title} · NoteFlow`);
  });

  it.each(['/privacy', '/terms'])(
    '%s is the same for a signed-in user (no redirect)',
    async (path) => {
      new FakeApi();
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    },
  );

  it('survives a refresh: mounting again at the same address renders the same page', async () => {
    signedOut();
    const first = renderAt('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    first.unmount();
    renderAt('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
  });

  it('has a way back to NoteFlow and links the two documents to each other', async () => {
    signedOut();
    renderAt('/privacy');
    await screen.findByRole('heading', { name: 'Privacy Policy' });
    expect(screen.getByRole('link', { name: /back to noteflow/i })).toHaveAttribute('href', '/');
    const footer = screen.getByRole('navigation', { name: 'Legal' });
    expect(within(footer).getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(within(footer).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});

describe('what the Privacy Policy says matches how NoteFlow works', () => {
  it('names the exact Calendar permission the server requests, and the separate consent', async () => {
    signedOut();
    renderAt('/privacy');
    await screen.findByRole('heading', { name: 'Privacy Policy' });
    const scope = 'https://www.googleapis.com/auth/calendar.events.owned';
    expect(screen.getByText(scope)).toBeInTheDocument();
    // The policy must quote the same default the backend actually asks Google for.
    const env = readFileSync(resolve(__dirname, '../../backend/src/config/env.ts'), 'utf8');
    expect(env).toContain(scope);
    expect(
      screen.getByText(/signing in never gives noteflow access to your calendar/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Google API Services User Data Policy/)).toBeInTheDocument();
  });

  it('covers AI, notifications, storage providers and deletion honestly', async () => {
    signedOut();
    renderAt('/privacy');
    await screen.findByRole('heading', { name: 'Privacy Policy' });
    for (const heading of [
      'What we collect',
      'AI processing',
      'Sign-in and sessions',
      'Google Calendar (separate, optional)',
      'Email and push notifications',
      'Services we use',
      'Storage, retention and deletion',
      'Your choices',
      'Security',
      'Contact',
    ]) {
      expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
    }
    // Facts that must not be overstated: no delete-account button, notes are not end-to-end encrypted.
    expect(screen.getByText(/no .*delete my account.* button/i)).toBeInTheDocument();
    expect(screen.getByText(/not end-to-end encrypted/i)).toBeInTheDocument();
    expect(screen.getByText(/currently uses/i)).toHaveTextContent(/groq/i);
  });

  it('every table-of-contents link points at a real section', async () => {
    signedOut();
    const { container } = renderAt('/privacy');
    await screen.findByRole('heading', { name: 'Privacy Policy' });
    const links = [...container.querySelectorAll('.legal-toc a')];
    expect(links.length).toBeGreaterThan(8);
    for (const a of links) {
      const id = a.getAttribute('href')?.slice(1) ?? '';
      expect(container.querySelector(`#${id}`), `section #${id}`).not.toBeNull();
    }
  });

  it.each([
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
  ])('%s publishes the one configured contact address and nothing else', async (path, title) => {
    signedOut();
    const { container } = renderAt(path);
    await screen.findByRole('heading', { name: title });
    const contact = screen.getByRole('heading', { name: 'Contact', level: 2 }).closest('section');
    expect(contact).not.toBeNull();
    const mail = within(contact as HTMLElement).getByRole('link', { name: CONTACT_EMAIL ?? '' });
    expect(mail).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
    // The only mailto on the page is that one: no other address, postal address or phone number.
    expect(container.querySelectorAll('a[href^="mailto:"]')).toHaveLength(1);
  });
});

describe('what the Terms say', () => {
  it('covers the required topics, including reliability and the calendar', async () => {
    signedOut();
    renderAt('/terms');
    await screen.findByRole('heading', { name: 'Terms of Service' });
    for (const heading of [
      'Your account',
      'Acceptable use',
      'AI-generated results',
      'Reminders and notifications are not guaranteed',
      'Google Calendar integration',
      'Availability and changes',
      'Suspension and ending your use',
      'Limits of liability',
      'Contact',
    ]) {
      expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
    }
    // It must not pretend there is a company behind the service.
    expect(screen.getByText(/no company or registered business/i)).toBeInTheDocument();
  });
});

describe('links to the documents', () => {
  it('the sign-in page links to both, to the right addresses', async () => {
    signedOut();
    renderAt('/login');
    await screen.findByRole('link', { name: /sign in with google/i });
    const privacy = screen.getAllByRole('link', { name: 'Privacy Policy' });
    const terms = screen.getAllByRole('link', { name: 'Terms of Service' });
    expect(privacy.length).toBeGreaterThanOrEqual(1);
    expect(terms.length).toBeGreaterThanOrEqual(1);
    for (const a of privacy) expect(a).toHaveAttribute('href', '/privacy');
    for (const a of terms) expect(a).toHaveAttribute('href', '/terms');
  });

  it('Settings links to both for a signed-in user', async () => {
    new FakeApi();
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Legal' });
    expect(within(nav).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(within(nav).getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
  });
});

describe('mobile layout', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles/global.css'), 'utf8');
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

  it('the page declares a responsive viewport', () => {
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1.0"/);
  });

  it('is one readable column with a narrow-screen rule and no fixed widths', () => {
    expect(css).toMatch(/\.legal-main\s*\{[^}]*max-width:\s*46rem/);
    // The shared .back-link is hidden on wide screens; the legal header must show it anyway.
    expect(css).toMatch(/\.legal-header \.back-link\s*\{[^}]*display:\s*inline-flex/);
    expect(css).toMatch(/@media \(max-width: 600px\)\s*\{[^@]*\.legal-toc ol\s*\{\s*columns:\s*1/);
    // Long URLs and the scope string wrap instead of forcing sideways scrolling.
    expect(css).toMatch(/\.legal-section code\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
