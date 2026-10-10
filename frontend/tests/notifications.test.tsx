import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { FakeApi } from './fakeApi';

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-abc';

/** A scriptable Push API: permission, an existing subscription, and what the prompt answers. */
function stubPush({
  permission = 'default',
  subscribed = false,
  prompt = 'granted',
}: {
  permission?: NotificationPermission;
  subscribed?: boolean;
  prompt?: NotificationPermission;
} = {}) {
  const state = { permission, sub: null as null | ReturnType<typeof makeSub> };
  const makeSub = () => ({
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    unsubscribe: vi.fn(async () => {
      state.sub = null;
      return true;
    }),
  });
  if (subscribed) state.sub = makeSub();
  const pushManager = {
    getSubscription: vi.fn(async () => state.sub),
    subscribe: vi.fn(async () => {
      state.sub = makeSub();
      return state.sub;
    }),
  };
  const registration = { pushManager };
  const requestPermission = vi.fn(async () => {
    state.permission = prompt;
    return prompt;
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn(async () => registration), ready: Promise.resolve(registration) },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    get permission() {
      return state.permission;
    },
    requestPermission,
  });
  return { state, pushManager, requestPermission };
}

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom has no service worker support; remove what a test installed.
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('notification settings', () => {
  it('says so when the browser has no push support, and offers no button', async () => {
    new FakeApi();
    renderSettings();
    expect(await screen.findByText(/does not support push notifications/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable notifications/i })).not.toBeInTheDocument();
  });

  it('says so when this server has no push keys', async () => {
    const api = new FakeApi();
    api.notifications.push.available = false;
    stubPush();
    renderSettings();
    expect(await screen.findByText(/not set up on this server/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable notifications/i })).not.toBeInTheDocument();
  });

  it('explains how to recover when notifications are blocked', async () => {
    new FakeApi();
    stubPush({ permission: 'denied' });
    renderSettings();
    expect(await screen.findByText(/blocked for this site/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable notifications/i })).not.toBeInTheDocument();
  });

  it('never asks for permission on load, only when the user clicks', async () => {
    const api = new FakeApi();
    const push = stubPush();
    renderSettings();
    const button = await screen.findByRole('button', {
      name: /enable notifications on this device/i,
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(api.calls('POST', '/api/notifications/push-subscriptions')).toHaveLength(0);

    await userEvent.click(button);
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/notifications are on for this device/i)).toBeInTheDocument();
    const [post] = api.calls('POST', '/api/notifications/push-subscriptions');
    expect(post?.body).toMatchObject({
      endpoint: ENDPOINT,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect(typeof (post?.body as { label?: unknown } | undefined)?.label).toBe('string');
    expect(await screen.findByText(/1 device is subscribed/i)).toBeInTheDocument();
  });

  it('sends nothing to the server when the user declines the prompt', async () => {
    const api = new FakeApi();
    stubPush({ prompt: 'denied' });
    renderSettings();
    await userEvent.click(
      await screen.findByRole('button', { name: /enable notifications on this device/i }),
    );
    expect(await screen.findByText(/blocked for this site/i)).toBeInTheDocument();
    expect(api.calls('POST', '/api/notifications/push-subscriptions')).toHaveLength(0);
  });

  it('recognises an existing subscription and renews it with the server', async () => {
    const api = new FakeApi();
    stubPush({ permission: 'granted', subscribed: true });
    renderSettings();
    expect(await screen.findByText(/notifications are on for this device/i)).toBeInTheDocument();
    expect(api.calls('POST', '/api/notifications/push-subscriptions')).toHaveLength(1);
  });

  it('turns notifications off for this device: server and browser both forget it', async () => {
    const api = new FakeApi();
    const push = stubPush({ permission: 'granted', subscribed: true });
    renderSettings();
    await screen.findByText(/notifications are on for this device/i);
    const sub = push.state.sub;
    await userEvent.click(screen.getByRole('button', { name: /turn off on this device/i }));
    expect(
      await screen.findByRole('button', { name: /enable notifications on this device/i }),
    ).toBeInTheDocument();
    expect(sub?.unsubscribe).toHaveBeenCalled();
    expect(api.pushDevices).toHaveLength(0);
    expect(
      api.requests.some((r) => r.method === 'DELETE' && r.url.includes('push-subscriptions')),
    ).toBe(true);
  });

  it('saves the email, pause and show-text choices', async () => {
    const api = new FakeApi();
    stubPush({ permission: 'granted', subscribed: true });
    renderSettings();
    await screen.findByText(/notifications are on for this device/i);

    await userEvent.click(
      screen.getByRole('checkbox', { name: /email me when a reminder is due/i }),
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: /show the reminder text in the notification/i }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /send push notifications/i }));
    await waitFor(() => {
      expect(api.notifications.email.enabled).toBe(false);
      expect(api.notifications.push.showText).toBe(true);
      expect(api.notifications.push.enabled).toBe(false);
    });
    // The text option is off until the user turns it on.
    expect(new FakeApi().notifications.push.showText).toBe(false);
  });

  it('disables the email choice and says why when the server cannot send email', async () => {
    const api = new FakeApi();
    api.notifications.email.available = false;
    renderSettings();
    expect(await screen.findByText(/email is not set up on this server/i)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /email me when a reminder is due/i }),
    ).toBeDisabled();
  });
});
