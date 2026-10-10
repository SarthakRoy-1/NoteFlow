import { vi } from 'vitest';

export interface FakeAnalysis {
  status: 'pending' | 'ok' | 'failed';
  error: string | null;
  todos: number;
  reminders: number;
  pendingReminders?: number;
}

/** A reminder the AI found that still needs a date and time (GET /api/reminder-drafts). */
export interface FakeDraft {
  id: string;
  text: string;
  person: string | null;
  suggestedDate: string | null;
  recurrence: { days: number[] } | null;
  sourceNote: { id: string; title: string };
  createdAt: string;
}

export interface FakeNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  analysis: FakeAnalysis;
}

export interface FakeTodo {
  id: string;
  title: string;
  completed: boolean;
  completedAt: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  sourceNote: { id: string; title: string };
}

export interface FakeReminder {
  id: string;
  text: string;
  person: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  recurrence: { days: number[]; time: string | null } | null;
  status: 'pending' | 'acknowledged' | 'dismissed';
  acknowledgedAt: string | null;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  sourceNote: { id: string; title: string };
  sharedWith: { shareId: string; name: string; email: string }[];
}

/** A reminder somebody else shared with the signed-in user (what GET /api/shared-reminders returns). */
export interface FakeShared {
  id: string;
  text: string;
  dueAt: string | null;
  dueHasTime: boolean;
  recurrence: { days: number[]; time: string | null } | null;
  from: { name: string };
  sharedAt: string;
  acknowledgedAt: string | null;
  isNew: boolean;
  due: boolean;
  occurrenceAt: string | null;
}

export interface FakeAsk {
  id: string;
  question: string;
  answer: string;
  status: 'answered' | 'no_info' | 'failed';
  createdAt: string;
  sources: { noteId: string | null; title: string }[];
}

export const testUser = {
  id: 'u1',
  email: 'pat@example.com',
  name: 'Pat Person',
  timezone: 'Europe/London',
  signIn: { password: false, google: true },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

/**
 * Stand-in for the HTTP layer only (the app code under test is the real UI). It behaves like the
 * documented API contract and records every request so tests can assert what was sent.
 */
export class FakeApi {
  notes: FakeNote[] = [];
  todos: FakeTodo[] = [];
  reminders: FakeReminder[] = [];
  drafts: FakeDraft[] = [];
  /** GET /api/calendar/status. Tests change it directly. */
  calendar: {
    available: boolean;
    connected: boolean;
    status: 'connected' | 'needs_reconnect' | null;
    googleEmail: string | null;
  } = { available: true, connected: false, status: null, googleEmail: null };
  /** What each POST /api/calendar/sync returns, in order (then "nothing to do"). */
  syncResults: {
    result: 'ok' | 'not_connected' | 'needs_reconnect';
    synced: number;
    failed: number;
    remaining: number;
  }[] = [];
  /** Reminders other users shared with the signed-in user. */
  sharedWithMe: FakeShared[] = [];
  asks: FakeAsk[] = [];
  /** What the next successful POST /api/ask returns (besides id, question and time). */
  askResult: Pick<FakeAsk, 'answer' | 'status' | 'sources'> = {
    answer: 'You fly to Berlin in May.',
    status: 'answered',
    sources: [{ noteId: '00000000-0000-4000-8000-0000000000aa', title: 'Berlin trip' }],
  };
  /** What a successful retry produces. */
  analysisAfterRetry: FakeAnalysis = { status: 'ok', error: null, todos: 1, reminders: 0 };
  /** Analysis attached to notes created through the UI. */
  analysisOnCreate: FakeAnalysis = { status: 'ok', error: null, todos: 0, reminders: 0 };
  signedIn = true;
  /** Whether the fake server can send email (GET /api/auth/config). */
  emailEnabled = true;
  /** Whether custom email/password auth is on (the server default is off). */
  passwordAuthEnabled = true;
  /** Password accounts known to the fake sign-in/registration endpoints. */
  accounts: { email: string; password: string; name: string }[] = [
    { email: 'pat@example.com', password: 'correct horse battery', name: 'Pat Person' },
  ];
  me = { ...testUser };
  /** GET /api/notifications. Tests change `push.available`, `email.available` and so on directly. */
  notifications = {
    email: { available: true, enabled: true },
    push: {
      available: true,
      enabled: true,
      showText: false,
      publicKey: 'BFakeVapidPublicKey_0123456789',
      subscriptions: [] as { id: string; label: string; createdAt: string }[],
    },
  };
  pushDevices: { id: string; endpoint: string; label: string }[] = [];
  requests: { method: string; url: string; body?: unknown }[] = [];
  /** Per-"METHOD /path" override that returns a custom response once (or always if `sticky`). */
  private overrides = new Map<string, { make: () => Response; sticky: boolean }>();
  private holds = new Map<string, Promise<void>>();
  private counter = 0;
  private clock = Date.parse('2026-01-01T10:00:00Z');

  constructor(initial: Partial<FakeNote>[] = []) {
    initial.forEach((n) => this.add(n));
    this.install();
  }

  addAsk(partial: Partial<FakeAsk> = {}): FakeAsk {
    this.counter += 1;
    const ask: FakeAsk = {
      id: `30000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      question: `Question ${this.counter}`,
      answer: `Answer ${this.counter}`,
      status: 'answered',
      createdAt: new Date((this.clock += 60_000)).toISOString(),
      sources: [],
      ...partial,
    };
    this.asks.push(ask);
    return ask;
  }

  addReminder(partial: Partial<FakeReminder> = {}): FakeReminder {
    this.counter += 1;
    const stamp = new Date((this.clock += 60_000)).toISOString();
    const reminder: FakeReminder = {
      id: `20000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      text: `Reminder ${this.counter}`,
      person: null,
      dueAt: null,
      dueHasTime: true,
      recurrence: null,
      status: 'pending',
      acknowledgedAt: null,
      createdByAi: true,
      createdAt: stamp,
      updatedAt: stamp,
      sourceNote: { id: '00000000-0000-4000-8000-0000000000aa', title: 'Source note' },
      sharedWith: [],
      ...partial,
    };
    this.reminders.push(reminder);
    return reminder;
  }

  addShared(partial: Partial<FakeShared> = {}): FakeShared {
    this.counter += 1;
    const stamp = new Date((this.clock += 60_000)).toISOString();
    const shared: FakeShared = {
      id: `40000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      text: `Shared reminder ${this.counter}`,
      dueAt: null,
      dueHasTime: true,
      recurrence: null,
      from: { name: 'Sam Sender' },
      sharedAt: stamp,
      acknowledgedAt: null,
      isNew: true,
      due: false,
      occurrenceAt: null,
      ...partial,
    };
    this.sharedWithMe.push(shared);
    return shared;
  }

  addTodo(partial: Partial<FakeTodo> = {}): FakeTodo {
    this.counter += 1;
    const stamp = new Date((this.clock += 60_000)).toISOString();
    const todo: FakeTodo = {
      id: `10000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      title: `Todo ${this.counter}`,
      completed: false,
      completedAt: null,
      dueAt: null,
      dueHasTime: false,
      createdByAi: true,
      createdAt: stamp,
      updatedAt: stamp,
      sourceNote: { id: '00000000-0000-4000-8000-0000000000aa', title: 'Source note' },
      ...partial,
    };
    this.todos.push(todo);
    return todo;
  }

  add(partial: Partial<FakeNote> = {}): FakeNote {
    this.counter += 1;
    const stamp = new Date((this.clock += 60_000)).toISOString();
    const note: FakeNote = {
      id: `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      title: `Note ${this.counter}`,
      content: `Content ${this.counter}`,
      createdAt: stamp,
      updatedAt: stamp,
      analysis: { status: 'ok', error: null, todos: 0, reminders: 0 },
      ...partial,
    };
    this.notes.push(note);
    return note;
  }

  failNext(methodAndPath: string, response: () => Response, sticky = false) {
    this.overrides.set(methodAndPath, { make: response, sticky });
  }

  /** Delay the next matching request until the returned function is called. */
  holdNext(methodAndPath: string): () => void {
    let release = () => {};
    this.holds.set(
      methodAndPath,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  private install() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => this.handle(url, init)),
    );
  }

  private async handle(url: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.requests.push({ method, url, body });

    const key = `${method} ${url}`;
    const hold = this.holds.get(key);
    if (hold) {
      this.holds.delete(key);
      await hold;
    }
    const override = this.overrides.get(key);
    if (override) {
      if (!override.sticky) this.overrides.delete(key);
      return override.make();
    }

    if (url === '/api/auth/login' && method === 'POST') {
      const account = this.accounts.find((a) => a.email === String(body?.email).toLowerCase());
      if (!account || account.password !== body?.password) {
        return apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      this.signedIn = true;
      this.me = { ...testUser, email: account.email, name: account.name };
      return json({ user: this.me });
    }
    if (url === '/api/auth/config')
      return json({
        passwordAuthEnabled: this.passwordAuthEnabled,
        emailEnabled: this.emailEnabled,
      });
    if (url === '/api/auth/register' && method === 'POST') {
      // Always the same generic answer, like the real server.
      return json({ status: 'verification_sent' }, 202);
    }
    if (url === '/api/auth/resend-verification' || url === '/api/auth/forgot-password') {
      return json({ status: 'sent' }, 202);
    }
    if (url === '/api/auth/verify-email' && method === 'POST') {
      if (body?.token === 'expired-token-0000000000') {
        return apiError(410, 'TOKEN_EXPIRED', 'This link has expired. Please request a new one.');
      }
      if (body?.token !== 'good-token-000000000000') {
        return apiError(
          400,
          'TOKEN_INVALID',
          'This link is not valid, or it has already been used.',
        );
      }
      if (body?.password !== 'correct horse battery') {
        return apiError(
          401,
          'PASSWORD_MISMATCH',
          'That is not the password you chose when signing up.',
        );
      }
      this.signedIn = true;
      this.me = {
        ...testUser,
        email: 'new@example.com',
        name: 'New Person',
        signIn: { password: true, google: false },
      };
      return json({ user: this.me });
    }
    if (url === '/api/auth/reset-password' && method === 'POST') {
      if (body?.token === 'expired-token-0000000000') {
        return apiError(410, 'TOKEN_EXPIRED', 'This link has expired. Please request a new one.');
      }
      if (body?.token !== 'good-token-000000000000') {
        return apiError(
          400,
          'TOKEN_INVALID',
          'This link is not valid, or it has already been used.',
        );
      }
      return json({ status: 'password_reset' });
    }
    if (!this.signedIn && url !== '/api/auth/logout') {
      return apiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    }
    if (url === '/api/me' && method === 'PATCH') {
      const tz = body?.timezone;
      const valid =
        typeof tz === 'string' &&
        (tz === 'UTC' || tz.includes('/')) &&
        Object.keys(body).length === 1 &&
        (() => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        })();
      if (!valid)
        return apiError(422, 'VALIDATION_FAILED', 'Timezone must be a valid IANA identifier.');
      this.me = { ...this.me, timezone: tz };
      return json({ user: this.me });
    }
    if (url === '/api/auth/link/google/start' && method === 'POST') {
      if (body?.password !== 'correct horse battery') {
        return apiError(401, 'REAUTH_FAILED', 'That password is not correct.');
      }
      return json({ url: 'https://accounts.example.test/authorize?state=abc' });
    }
    if (url === '/api/notifications' && method === 'GET') return json(this.notifications);
    if (url === '/api/notifications' && method === 'PATCH') {
      const allowed = ['emailEnabled', 'pushEnabled', 'pushShowText'];
      if (!body || Object.keys(body).some((k) => !allowed.includes(k))) {
        return apiError(422, 'VALIDATION_FAILED', 'Nothing to change.');
      }
      const n = this.notifications;
      if (body.emailEnabled !== undefined) n.email.enabled = body.emailEnabled;
      if (body.pushEnabled !== undefined) n.push.enabled = body.pushEnabled;
      if (body.pushShowText !== undefined) n.push.showText = body.pushShowText;
      return json(n);
    }
    if (url === '/api/notifications/push-subscriptions/lookup' && method === 'POST') {
      const found = this.pushDevices.find((d) => d.endpoint === body.endpoint);
      return json({ id: found?.id ?? null });
    }
    if (url === '/api/notifications/push-subscriptions' && method === 'POST') {
      const existing = this.pushDevices.find((d) => d.endpoint === body.endpoint);
      const id = existing?.id ?? `device-${this.pushDevices.length + 1}`;
      if (!existing) this.pushDevices.push({ id, endpoint: body.endpoint, label: body.label });
      this.notifications.push.subscriptions = this.pushDevices.map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: '2026-10-08T10:00:00.000Z',
      }));
      return json({ id }, 201);
    }
    const pushDelete = /^\/api\/notifications\/push-subscriptions\/([^/]+)$/.exec(url);
    if (pushDelete && method === 'DELETE') {
      this.pushDevices = this.pushDevices.filter((d) => d.id !== pushDelete[1]);
      this.notifications.push.subscriptions = this.pushDevices.map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: '2026-10-08T10:00:00.000Z',
      }));
      return new Response(null, { status: 204 });
    }
    if (url === '/api/me') return json({ user: this.me });
    if (url === '/api/auth/logout') {
      this.signedIn = false;
      return new Response(null, { status: 204 });
    }

    if (url === '/api/notes' && method === 'GET') {
      const sorted = [...this.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return json({
        notes: sorted.map((n) => ({
          id: n.id,
          title: n.title,
          preview: n.content.slice(0, 160),
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        })),
      });
    }
    if (url === '/api/notes' && method === 'POST') {
      const note = this.add({
        title: body.title,
        content: body.content,
        analysis: this.analysisOnCreate,
      });
      return json({ note }, 201);
    }
    if (url === '/api/ask' && method === 'POST') {
      if (typeof body?.question !== 'string' || !body.question.trim()) {
        return apiError(422, 'VALIDATION_FAILED', 'Some of the information you sent is not valid.');
      }
      const ask = this.addAsk({ question: body.question, ...this.askResult });
      return json({ ask }, 201);
    }
    if (url === '/api/ask/history' && method === 'GET') {
      return json({ history: [...this.asks].reverse() });
    }
    if (url === '/api/reminders/due' && method === 'GET') {
      const now = Date.now();
      const pending = this.reminders.filter((r) => r.status === 'pending' && r.dueAt);
      const due = pending
        .filter((r) => new Date(r.dueAt as string).getTime() <= now)
        .sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string));
      const future = pending
        .filter((r) => new Date(r.dueAt as string).getTime() > now)
        .map((r) => r.dueAt as string)
        .sort();
      return json({ reminders: due, nextDueAt: future[0] ?? null });
    }
    if (url === '/api/reminders' && method === 'GET') {
      const rank = (r: FakeReminder) => (r.status === 'pending' ? 0 : 1);
      const sorted = [...this.reminders].sort(
        (a, b) => rank(a) - rank(b) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'),
      );
      return json({ reminders: sorted });
    }
    if (url === '/api/reminder-drafts' && method === 'GET') {
      return json({ drafts: this.drafts });
    }
    const draftMatch = /^\/api\/reminder-drafts\/([^/]+)(\/complete)?$/.exec(url);
    if (draftMatch) {
      const draft = this.drafts.find((d) => d.id === draftMatch[1]);
      if (!draft) return apiError(404, 'NOT_FOUND', 'We could not find that pending reminder.');
      if (method === 'DELETE') {
        this.drafts = this.drafts.filter((d) => d.id !== draft.id);
        return new Response(null, { status: 204 });
      }
      if (method === 'POST' && draftMatch[2]) {
        if (!body?.time) return apiError(422, 'VALIDATION_FAILED', 'Choose a time.');
        this.drafts = this.drafts.filter((d) => d.id !== draft.id);
        const reminder: FakeReminder = {
          id: `rem-from-${draft.id}`,
          text: draft.text,
          person: draft.person,
          dueAt: `${body.date ?? '2026-10-09'}T${body.time}:00.000Z`,
          dueHasTime: true,
          recurrence: draft.recurrence ? { days: draft.recurrence.days, time: body.time } : null,
          status: 'pending',
          acknowledgedAt: null,
          createdByAi: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceNote: draft.sourceNote,
          sharedWith: [],
        };
        this.reminders.push(reminder);
        return json({ reminder }, 201);
      }
    }
    if (url === '/api/calendar/status' && method === 'GET') return json(this.calendar);
    if (url === '/api/calendar/connect' && method === 'POST') {
      return json({ url: 'https://accounts.example.test/calendar-consent' });
    }
    if (url === '/api/calendar/sync' && method === 'POST') {
      const next = this.syncResults.shift() ?? { result: 'ok', synced: 0, failed: 0, remaining: 0 };
      return json(next);
    }
    if (url === '/api/calendar/disconnect' && method === 'POST') {
      this.calendar = { ...this.calendar, connected: false, status: null, googleEmail: null };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/shared-reminders' && method === 'GET') {
      return json({ shared: this.sharedWithMe, nextDueAt: null });
    }
    const sharedMatch = /^\/api\/shared-reminders\/([^/]+)$/.exec(url);
    if (sharedMatch) {
      const item = this.sharedWithMe.find((s) => s.id === sharedMatch[1]);
      if (!item) return apiError(404, 'NOT_FOUND', 'We could not find that shared reminder.');
      if (method === 'PATCH') {
        item.isNew = false;
        item.due = false;
        item.acknowledgedAt = new Date().toISOString();
        return json({ shared: item });
      }
      if (method === 'DELETE') {
        this.sharedWithMe = this.sharedWithMe.filter((s) => s.id !== item.id);
        return new Response(null, { status: 204 });
      }
    }
    const shareCreate = /^\/api\/reminders\/([^/]+)\/shares$/.exec(url);
    if (shareCreate && method === 'POST') {
      const reminder = this.reminders.find((r) => r.id === shareCreate[1]);
      if (!reminder) return apiError(404, 'NOT_FOUND', 'We could not find that reminder.');
      const email = String(body?.email ?? '');
      if (email === 'unknown@example.com') {
        return apiError(
          404,
          'RECIPIENT_NOT_FOUND',
          'We could not find a NoteFlow account for that email. They need to sign in to NoteFlow with that Google account first.',
        );
      }
      if (email === this.me.email) {
        return apiError(
          422,
          'CANNOT_SHARE_WITH_SELF',
          'That is your own account, so this reminder is already yours.',
        );
      }
      this.counter += 1;
      const name = email.split('@')[0] ?? 'friend';
      const shareId = `50000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
      reminder.sharedWith.push({ shareId, name, email });
      return json(
        {
          share: {
            id: shareId,
            recipient: { name, email },
            createdAt: new Date().toISOString(),
            acknowledgedAt: null,
          },
        },
        201,
      );
    }
    const shareDelete = /^\/api\/reminders\/([^/]+)\/shares\/([^/]+)$/.exec(url);
    if (shareDelete && method === 'DELETE') {
      const reminder = this.reminders.find((r) => r.id === shareDelete[1]);
      if (!reminder) return apiError(404, 'NOT_FOUND', 'We could not find that reminder.');
      reminder.sharedWith = reminder.sharedWith.filter((s) => s.shareId !== shareDelete[2]);
      return new Response(null, { status: 204 });
    }
    const reminderMatch = /^\/api\/reminders\/([^/]+)$/.exec(url);
    if (reminderMatch) {
      const reminder = this.reminders.find((r) => r.id === reminderMatch[1]);
      if (!reminder) return apiError(404, 'NOT_FOUND', 'We could not find that reminder.');
      if (method === 'GET') return json({ reminder });
      if (method === 'PATCH') {
        if (body.text !== undefined) reminder.text = body.text;
        if (body.person !== undefined) reminder.person = body.person?.trim() || null;
        if (body.due !== undefined) {
          reminder.dueAt = body.due ? `${body.due.date}T${body.due.time ?? '00:00'}:00.000Z` : null;
          reminder.dueHasTime = Boolean(body.due?.time);
          reminder.status = 'pending';
          reminder.acknowledgedAt = null;
        }
        if (body.recurrence !== undefined) {
          reminder.recurrence = body.recurrence
            ? {
                days: [...body.recurrence.days].sort(),
                time: reminder.dueHasTime && reminder.dueAt ? reminder.dueAt.slice(11, 16) : null,
              }
            : null;
        }
        if (body.acknowledged !== undefined) {
          if (reminder.recurrence && body.acknowledged) {
            // A repeating reminder re-arms: it moves to its next occurrence and stays pending.
            if (reminder.dueAt && new Date(reminder.dueAt).getTime() <= Date.now()) {
              // The next occurrence strictly after now (missed ones are not queued).
              let next = new Date(reminder.dueAt).getTime();
              while (next <= Date.now()) next += 7 * 86_400_000;
              reminder.dueAt = new Date(next).toISOString();
              reminder.acknowledgedAt = new Date().toISOString();
            }
          } else {
            reminder.status = body.acknowledged ? 'acknowledged' : 'pending';
            reminder.acknowledgedAt = body.acknowledged ? new Date().toISOString() : null;
          }
        }
        return json({ reminder });
      }
      if (method === 'DELETE') {
        this.reminders = this.reminders.filter((r) => r.id !== reminder.id);
        return new Response(null, { status: 204 });
      }
    }
    if (url === '/api/todos' && method === 'GET') {
      const sorted = [...this.todos].sort(
        (a, b) =>
          Number(a.completed) - Number(b.completed) ||
          (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'),
      );
      return json({ todos: sorted });
    }
    const todoMatch = /^\/api\/todos\/([^/]+)$/.exec(url);
    if (todoMatch) {
      const todo = this.todos.find((t) => t.id === todoMatch[1]);
      if (!todo) return apiError(404, 'NOT_FOUND', 'We could not find that todo.');
      if (method === 'GET') return json({ todo });
      if (method === 'PATCH') {
        if (body.title !== undefined) todo.title = body.title;
        if (body.completed !== undefined) {
          todo.completed = body.completed;
          todo.completedAt = body.completed ? new Date().toISOString() : null;
        }
        if (body.due !== undefined) {
          todo.dueAt = body.due
            ? `${body.due.date}T${body.due.time ?? '23:59:59.999'}Z`.replace('ZZ', 'Z')
            : null;
          todo.dueHasTime = Boolean(body.due?.time);
        }
        return json({ todo });
      }
      if (method === 'DELETE') {
        this.todos = this.todos.filter((t) => t.id !== todo.id);
        return new Response(null, { status: 204 });
      }
    }
    const analyze = /^\/api\/notes\/([^/]+)\/analyze$/.exec(url);
    if (analyze && method === 'POST') {
      const note = this.notes.find((n) => n.id === analyze[1]);
      if (!note) return apiError(404, 'NOT_FOUND', 'We could not find that note.');
      note.analysis = this.analysisAfterRetry;
      return json({ note });
    }
    const m = /^\/api\/notes\/([^/]+)$/.exec(url);
    if (m) {
      const note = this.notes.find((n) => n.id === m[1]);
      if (!note) return apiError(404, 'NOT_FOUND', 'We could not find that note.');
      if (method === 'GET') return json({ note });
      if (method === 'PATCH') {
        Object.assign(note, body, { updatedAt: new Date((this.clock += 60_000)).toISOString() });
        return json({ note });
      }
      if (method === 'DELETE') {
        this.notes = this.notes.filter((n) => n.id !== note.id);
        return new Response(null, { status: 204 });
      }
    }
    return apiError(404, 'NOT_FOUND', 'That endpoint does not exist.');
  }

  calls(method: string, url: string) {
    return this.requests.filter((r) => r.method === method && r.url === url);
  }
}
