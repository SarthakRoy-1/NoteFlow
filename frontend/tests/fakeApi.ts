import { vi } from 'vitest';

export interface FakeAnalysis {
  status: 'pending' | 'ok' | 'failed';
  error: string | null;
  todos: number;
  reminders: number;
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
  status: 'pending' | 'acknowledged' | 'dismissed';
  acknowledgedAt: string | null;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  sourceNote: { id: string; title: string };
}

export const testUser = {
  id: 'u1',
  email: 'pat@example.com',
  name: 'Pat Person',
  timezone: 'Europe/London',
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
  /** What a successful retry produces. */
  analysisAfterRetry: FakeAnalysis = { status: 'ok', error: null, todos: 1, reminders: 0 };
  /** Analysis attached to notes created through the UI. */
  analysisOnCreate: FakeAnalysis = { status: 'ok', error: null, todos: 0, reminders: 0 };
  signedIn = true;
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

  addReminder(partial: Partial<FakeReminder> = {}): FakeReminder {
    this.counter += 1;
    const stamp = new Date((this.clock += 60_000)).toISOString();
    const reminder: FakeReminder = {
      id: `20000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      text: `Reminder ${this.counter}`,
      person: null,
      dueAt: null,
      dueHasTime: true,
      status: 'pending',
      acknowledgedAt: null,
      createdByAi: true,
      createdAt: stamp,
      updatedAt: stamp,
      sourceNote: { id: '00000000-0000-4000-8000-0000000000aa', title: 'Source note' },
      ...partial,
    };
    this.reminders.push(reminder);
    return reminder;
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

    if (!this.signedIn && url !== '/api/auth/logout') {
      return apiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    }
    if (url === '/api/me') return json({ user: testUser });
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
        if (body.acknowledged !== undefined) {
          reminder.status = body.acknowledged ? 'acknowledged' : 'pending';
          reminder.acknowledgedAt = body.acknowledged ? new Date().toISOString() : null;
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
