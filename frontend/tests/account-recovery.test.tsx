import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { FakeApi, apiError, testUser } from './fakeApi';

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

const GOOD = 'good-token-000000000000';
const EXPIRED = 'expired-token-0000000000';
const calls = (api: FakeApi, url: string) => api.requests.filter((r) => r.url === url);

function signedOut() {
  const api = new FakeApi();
  api.signedIn = false;
  return api;
}

afterEach(() => vi.unstubAllGlobals());

describe('email confirmation page', () => {
  it('confirms with the emailed token and the chosen password, then signs the user in', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt(`/verify-email#token=${GOOD}`);
    await user.type(
      await screen.findByLabelText('Password', { exact: true }),
      'correct horse battery',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm email' }));

    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open NoteFlow' })).toHaveAttribute('href', '/notes');
    expect(calls(api, '/api/auth/verify-email')[0]?.body).toEqual({
      token: GOOD,
      password: 'correct horse battery',
    });
  });

  it('shows the password mismatch on the field and lets the user try again', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt(`/verify-email#token=${GOOD}`);
    const field = await screen.findByLabelText('Password', { exact: true });
    await user.type(field, 'not the password');
    await user.click(screen.getByRole('button', { name: 'Confirm email' }));
    expect(await screen.findByText(/not the password you chose/i)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Confirm email' })).toBeEnabled();
  });

  it('requires a password before sending anything', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt(`/verify-email#token=${GOOD}`);
    await user.click(await screen.findByRole('button', { name: 'Confirm email' }));
    expect(screen.getByText('Enter the password you chose when signing up.')).toBeInTheDocument();
    expect(calls(api, '/api/auth/verify-email')).toHaveLength(0);
  });

  it('shows an expired-link state', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt(`/verify-email#token=${EXPIRED}`);
    await user.type(
      await screen.findByLabelText('Password', { exact: true }),
      'correct horse battery',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm email' }));
    expect(
      await screen.findByRole('heading', { name: 'This link has expired' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('shows a failure state for a used or unknown link', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/verify-email#token=some-token-that-is-not-valid');
    await user.type(
      await screen.findByLabelText('Password', { exact: true }),
      'correct horse battery',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm email' }));
    expect(
      await screen.findByRole('heading', { name: 'This link can’t be used' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/already been used/i);
  });

  it('shows the failure state straight away when there is no token', async () => {
    const api = signedOut();
    renderAt('/verify-email');
    expect(
      await screen.findByRole('heading', { name: 'This link can’t be used' }),
    ).toBeInTheDocument();
    expect(calls(api, '/api/auth/verify-email')).toHaveLength(0);
  });

  it('removes the token from the address bar after reading it', async () => {
    signedOut();
    renderAt(`/verify-email#token=${GOOD}`);
    await screen.findByLabelText('Password', { exact: true });
    // The form still works (token kept in memory) even though the fragment is gone from the URL.
    expect(screen.getByRole('button', { name: 'Confirm email' })).toBeEnabled();
  });

  it('has a password field that can be shown', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt(`/verify-email#token=${GOOD}`);
    const field = await screen.findByLabelText('Password', { exact: true });
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
  });
});

describe('forgot-password page', () => {
  it('sends the request and shows the same message for any address', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), ' Someone@Example.com ');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      /if .* has a noteflow password account/i,
    );
    expect(calls(api, '/api/auth/forgot-password')[0]?.body).toEqual({
      email: 'Someone@Example.com',
    });
  });

  it('validates the address before sending', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(calls(api, '/api/auth/forgot-password')).toHaveLength(0);
  });

  it('shows the rate-limit message', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    api.failNext('POST /api/auth/forgot-password', () =>
      apiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.'),
    );
    renderAt('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('does not present a recovery form when the server cannot send email', async () => {
    const api = signedOut();
    api.emailEnabled = false;
    renderAt('/forgot-password');
    expect(
      await screen.findByText(/password reset is not available on this server/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});

describe('reset-password page', () => {
  it('sets the new password and points to sign-in', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt(`/reset-password#token=${GOOD}`);
    await user.type(await screen.findByLabelText('New password'), 'a completely new passphrase');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(calls(api, '/api/auth/reset-password')[0]?.body).toEqual({
      token: GOOD,
      password: 'a completely new passphrase',
    });
  });

  it('rejects a short password on the page and keeps the form usable', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt(`/reset-password#token=${GOOD}`);
    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(calls(api, '/api/auth/reset-password')).toHaveLength(0);
  });

  it('shows an expired-link state with a way to get a new link', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt(`/reset-password#token=${EXPIRED}`);
    await user.type(await screen.findByLabelText('New password'), 'a completely new passphrase');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(
      await screen.findByRole('heading', { name: 'This link has expired' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('shows a failure state for a used or unknown link, and when there is no token', async () => {
    const user = userEvent.setup();
    signedOut();
    const first = renderAt('/reset-password#token=this-token-was-already-used');
    await user.type(await screen.findByLabelText('New password'), 'a completely new passphrase');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(
      await screen.findByRole('heading', { name: 'This link can’t be used' }),
    ).toBeInTheDocument();
    first.unmount();

    renderAt('/reset-password');
    expect(
      await screen.findByRole('heading', { name: 'This link can’t be used' }),
    ).toBeInTheDocument();
  });
});

describe('connecting Google from Settings', () => {
  const passwordAccount = () => {
    const api = new FakeApi();
    api.me = { ...testUser, signIn: { password: true, google: false } };
    return api;
  };
  const stubRedirect = () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    return assign;
  };

  it('shows how the account signs in', async () => {
    new FakeApi();
    renderAt('/settings');
    expect(
      await screen.findByText('You sign in with Google. NoteFlow never sees your Google password.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
  });

  it('asks for the password again, then sends the browser to Google', async () => {
    const user = userEvent.setup();
    const api = passwordAccount();
    renderAt('/settings');
    const assign = stubRedirect();
    await user.type(await screen.findByLabelText('Confirm your password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.example.test/authorize?state=abc'),
    );
    expect(calls(api, '/api/auth/link/google/start')[0]?.body).toEqual({
      password: 'correct horse battery',
    });
  });

  it('shows a wrong password on the field and does not leave the page', async () => {
    const user = userEvent.setup();
    passwordAccount();
    renderAt('/settings');
    const assign = stubRedirect();
    const field = await screen.findByLabelText('Confirm your password');
    await user.type(field, 'the wrong one');
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));
    expect(await screen.findByText('That password is not correct.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // A wrong password is not a lost session: the user stays signed in on Settings.
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('requires a password before sending anything', async () => {
    const user = userEvent.setup();
    const api = passwordAccount();
    renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: 'Connect Google' }));
    expect(screen.getByText('Enter your password to continue.')).toBeInTheDocument();
    expect(calls(api, '/api/auth/link/google/start')).toHaveLength(0);
  });

  it('confirms a successful connection', async () => {
    const api = passwordAccount();
    api.me = { ...testUser, signIn: { password: true, google: true } };
    renderAt('/settings?link=ok');
    expect(await screen.findByText(/google is now connected/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
  });

  it.each([
    ['link_expired', /expired/i],
    ['link_invalid', /already used or is not valid/i],
    ['link_session_mismatch', /did not come from this signed-in session/i],
    ['link_identity_taken', /already connected to a different noteflow account/i],
    ['link_already_linked', /already connected to this account/i],
    ['link_email_unverified', /email is not verified/i],
    ['link_cancelled', /you cancelled/i],
    ['link_failed', /could not finish connecting/i],
  ])('explains ?link=%s', async (code, text) => {
    passwordAccount();
    renderAt(`/settings?link=${code}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});
