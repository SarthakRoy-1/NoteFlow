import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { validateAuthFields } from '../src/features/auth/emailAuth';
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

function signedOut() {
  const api = new FakeApi();
  api.signedIn = false;
  return api;
}

const authCalls = (api: FakeApi) => api.requests.filter((r) => r.url.startsWith('/api/auth/'));

afterEach(() => vi.unstubAllGlobals());

describe('login screen: choosing how to sign in', () => {
  it('offers Google, email sign-in and account creation together', async () => {
    signedOut();
    renderAt('/login');
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: 'Sign in' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Create account' })).not.toBeChecked();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('switching to Create account adds a name field, a hint and keeps Google available', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    await user.click(await screen.findByRole('radio', { name: 'Create account' }));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    const google = screen.getByRole('link', { name: /sign up with google/i });
    expect(google.getAttribute('href')).toMatch(/^\/api\/auth\/google\?tz=/);
  });

  it('switching modes does not carry typed values or errors across', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'half@typed');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Create account' }));
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
  });

  it('shows the message for a Google email that already has a password account', async () => {
    signedOut();
    renderAt('/login?error=email_in_use');
    expect(await screen.findByRole('alert')).toHaveTextContent(/already has a noteflow account/i);
  });
});

describe('email sign-in', () => {
  it('signs in with the right password and lands in the app', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), '  Pat@Example.com ');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    const call = authCalls(api).find((r) => r.url === '/api/auth/login');
    expect(call?.method).toBe('POST');
    expect(call?.body).toEqual({ email: 'Pat@Example.com', password: 'correct horse battery' });
  });

  it('a wrong password shows one generic message and stays on the login page', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'pat@example.com');
    await user.type(screen.getByLabelText('Password'), 'definitely wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/email or password is incorrect/i);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('an unknown email gets the same message as a wrong password', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever it is');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/email or password is incorrect/i);
  });

  it('checks the fields before sending anything', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/login');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(authCalls(api).filter((r) => r.url === '/api/auth/login')).toHaveLength(0);
  });

  it('shows a loading state and prevents a second submit while waiting', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    const release = api.holdNext('POST /api/auth/login');
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'pat@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect(busy).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    await act(async () => release());
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(authCalls(api).filter((r) => r.url === '/api/auth/login')).toHaveLength(1);
  });

  it('tells the user when they are rate limited', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    api.failNext('POST /api/auth/login', () =>
      apiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.'),
    );
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'pat@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('reports a network failure without leaving the form stuck', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    api.failNext('POST /api/auth/login', () => {
      throw new TypeError('network down');
    });
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'pat@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});

describe('password field', () => {
  it('is hidden by default and can be shown and hidden again', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    const field = await screen.findByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'current-password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'password');
  });

  it('asks the browser to offer a new password when registering', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    await user.click(await screen.findByRole('radio', { name: 'Create account' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
  });
});

describe('registration', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, values: Record<string, string>) => {
    await user.click(await screen.findByRole('radio', { name: 'Create account' }));
    for (const [label, value] of Object.entries(values)) {
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole('button', { name: 'Create account' }));
  };

  it('asks the user to check their email instead of signing them in', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/login');
    await fill(user, {
      Name: '  Sam New ',
      Email: 'sam@example.com',
      Password: 'a brand new password',
    });
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('sam@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    const call = authCalls(api).find((r) => r.url === '/api/auth/register');
    expect(call?.body).toMatchObject({
      name: 'Sam New',
      email: 'sam@example.com',
      password: 'a brand new password',
    });
    expect(typeof (call?.body as { timezone: string }).timezone).toBe('string');
  });

  it('shows the same message whether or not the address was already registered', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    await fill(user, {
      Name: 'Pat Again',
      Email: 'pat@example.com',
      Password: 'another long password',
    });
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/if/i, { selector: 'p' })).toHaveTextContent(
      /can be used for a new account/i,
    );
  });

  it('can resend the link, with confirmation', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/login');
    await fill(user, { Name: 'Sam', Email: 'sam@example.com', Password: 'a brand new password' });
    await user.click(await screen.findByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText(/a new link is on its way/i)).toBeInTheDocument();
    const call = authCalls(api).find((r) => r.url === '/api/auth/resend-verification');
    expect(call?.body).toEqual({ email: 'sam@example.com' });
  });

  it('shows the server’s rate-limit message when resending too often', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/login');
    await fill(user, { Name: 'Sam', Email: 'sam@example.com', Password: 'a brand new password' });
    api.failNext('POST /api/auth/resend-verification', () =>
      apiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.'),
    );
    await user.click(await screen.findByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('lets the user go back and use a different email', async () => {
    const user = userEvent.setup();
    signedOut();
    renderAt('/login');
    await fill(user, { Name: 'Sam', Email: 'sam@example.com', Password: 'a brand new password' });
    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('rejects empty fields and a short password before any request', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    renderAt('/login');
    await fill(user, { Email: 'sam@example.com', Password: 'short' });
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(authCalls(api).filter((r) => r.url === '/api/auth/register')).toHaveLength(0);
  });

  it('does not offer email sign-up when the server cannot send email', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    api.emailEnabled = false;
    renderAt('/login');
    await user.click(await screen.findByRole('radio', { name: 'Create account' }));
    expect(await screen.findByText(/not available on this server yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign up with google/i })).toBeInTheDocument();
  });
});

describe('forgot-password link on the sign-in form', () => {
  it('is offered when the server can send email', async () => {
    signedOut();
    renderAt('/login');
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('is hidden when it could not work', async () => {
    const api = signedOut();
    api.emailEnabled = false;
    renderAt('/login');
    await screen.findByRole('button', { name: 'Sign in' });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument(),
    );
  });
});

describe('an account that still needs email confirmation', () => {
  it('is told so, and can ask for a new link', async () => {
    const user = userEvent.setup();
    const api = signedOut();
    api.failNext('POST /api/auth/login', () =>
      apiError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Please confirm your email address first. We can send you a new link.',
      ),
    );
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'old@example.com');
    await user.type(screen.getByLabelText('Password', { exact: true }), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm your email address/i);
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));
    const call = authCalls(api).find((r) => r.url === '/api/auth/resend-verification');
    expect(call?.body).toEqual({ email: 'old@example.com' });
  });
});

describe('validateAuthFields', () => {
  const ok = { name: 'Pat', email: 'pat@example.com', password: 'a long enough password' };

  it('accepts valid sign-in and registration input', () => {
    expect(validateAuthFields('signin', { ...ok, name: '' })).toEqual({});
    expect(validateAuthFields('register', ok)).toEqual({});
  });

  it.each(['', '   ', 'plain', 'a@b', '@x.com', 'a b@x.com', `${'a'.repeat(250)}@x.com`])(
    'rejects the email %j',
    (email) => {
      expect(validateAuthFields('signin', { ...ok, email }).email).toBeDefined();
    },
  );

  it('only enforces the minimum length when registering, never on sign-in', () => {
    expect(validateAuthFields('signin', { ...ok, password: 'short' }).password).toBeUndefined();
    expect(validateAuthFields('register', { ...ok, password: 'short' }).password).toMatch(/10/);
  });

  it('rejects an over-long password', () => {
    expect(validateAuthFields('register', { ...ok, password: 'x'.repeat(129) }).password).toMatch(
      /128/,
    );
  });
});
