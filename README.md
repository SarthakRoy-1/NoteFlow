# NoteFlow

AI notes, todos and reminders. Write notes in plain language; an AI model extracts todos and
reminders, and you can ask questions about your notes. Sign in with Google. (Custom email/password sign-in exists in the code but is disabled by default; see `ENABLE_PASSWORD_AUTH`.)

**Status:** every Core and Should-have item of the assignment is implemented (Google sign-in, notes CRUD, AI
extraction, todos, reminders with in-app alerts, Ask AI with history, time zones, no duplicates, AI labels).
Automated: `npm run check` passes (typecheck, lint, format, backend + frontend tests, production builds).
Verified by hand on a local machine only: see "Known limitations" at the end. Progress notes are in `Memory.md`.

## Stack

React + Vite + TypeScript · Node + Express + TypeScript · PostgreSQL + Drizzle · Zod · Luxon ·
Groq (`openai/gpt-oss-120b`) or Google Gemini, behind an `AIProvider` interface · Vitest.

## Prerequisites

- Node.js 20.12+ and npm 10+
- Docker (only to run the local development PostgreSQL), or any PostgreSQL 14+ you already have

## Setup

```bash
npm install
cp .env.example .env     # then fill in the values (see below)
```

### 1. Environment variables (`.env`, never committed)

| Variable                                | Purpose                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`                              | `development`, `test` or `production` (production makes cookies `Secure`) |
| `PORT`                                  | API port (default 3001)                                              |
| `APP_BASE_URL`                          | Frontend origin (default `http://localhost:5173`)                    |
| `SESSION_SECRET`                        | Random string, 32+ chars. Signs the short-lived OAuth cookie         |
| `SESSION_TTL_DAYS`                      | Session lifetime in days (default 14)                                |
| `POSTGRES_PASSWORD`                     | Password for the Docker dev database (used by `docker-compose.dev.yml`) |
| `DATABASE_URL`                          | Dev database, e.g. `postgres://noteflow:<password>@localhost:5432/noteflow` |
| `TEST_DATABASE_URL`                     | **Separate** test database; the name must end in `_test`             |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth client (see below) |
| `ENABLE_PASSWORD_AUTH` | `false` by default. The assignment requires Google OAuth and forbids a custom email/password login, so register, login, email verification, password reset and Google linking return 404 and the UI hides them. Set `true` only to deliberately re-enable that implementation. Nothing is deleted when it is off |
| (note) | Password-only accounts cannot sign in while `ENABLE_PASSWORD_AUTH` is off; their records are kept and work again if it is set to `true`. Google OAuth is the supported sign-in path |
| `EMAIL_PROVIDER` (`smtp` or `resend`), `EMAIL_FROM` | Which sender delivers verification and reset mail. Without a complete provider those features are switched off in the UI and the API returns 503 (Google sign-in is unaffected). An explicit provider with missing variables leaves email off and logs a warning naming the missing variables (never values) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | SMTP sender. Gmail: `smtp.gmail.com`, `465`, `true`, your Gmail address, and a Google [App Password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification). No domain required |
| `RESEND_API_KEY` | Resend sender (needs a domain-verified `EMAIL_FROM`) |
| `GEMINI_API_KEY` / `GEMINI_MODEL`       | Gemini API key and model name (backend-only; the model is never hardcoded). If either is missing the app still runs and shows "AI analysis is not set up" on saved notes |
| `AI_PROVIDER` (`gemini` or `groq`)      | Which AI provider answers. Blank = Gemini if configured, otherwise Groq if configured. A chosen provider that is incomplete turns AI off; it never falls back to the other one |
| `GROQ_API_KEY` / `GROQ_MODEL`           | Groq API key (backend-only) and an optional model override (default `openai/gpt-oss-120b`). Uses Groq's OpenAI-compatible chat API with strict JSON-schema output; the reply is still validated by the backend |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. PostgreSQL (development)

Start the development database (Docker, one container, data kept in a named volume):

```bash
docker compose -f docker-compose.dev.yml up -d
```

Use `POSTGRES_PASSWORD` in `DATABASE_URL`/`TEST_DATABASE_URL`, for example:

```
DATABASE_URL=postgres://noteflow:<POSTGRES_PASSWORD>@localhost:5432/noteflow
TEST_DATABASE_URL=postgres://noteflow:<POSTGRES_PASSWORD>@localhost:5432/noteflow_test
```

Apply the SQL migrations to the dev database:

```bash
npm run db:migrate -w backend
```

After editing `backend/src/db/schema.ts`, generate a new migration and commit it:

```bash
npm run db:generate -w backend
```

`docker-compose.dev.yml` is the development database only. The full stack (PostgreSQL + API + web) is `docker-compose.yml`:

```bash
# .env needs POSTGRES_PASSWORD and SESSION_SECRET (and Google/Groq keys to sign in and use AI)
docker compose up --build
# open http://localhost:8080  (add http://localhost:8080/api/auth/google/callback to your OAuth client)
```

The API container applies migrations on start; `NODE_ENV=development` inside this compose file is only so the session cookie works over plain http.

### 3. Google OAuth (local setup)

1. Open <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → OAuth consent screen**: choose _External_, fill in the app name and your
   email, and add yourself under **Test users** while the app is in testing mode.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → _Web application_.
4. Under **Authorized redirect URIs** add exactly:
   `http://localhost:5173/api/auth/google/callback`
5. Copy the client ID and secret into `.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:5173/api/auth/google/callback
   ```
   (The redirect goes through the Vite dev proxy so the session cookie stays same-origin.)

Without these values the app still starts; clicking "Sign in with Google" returns to the login page
with a clear "not set up" message. There is no fake or bypass login.

### 4. Run

```bash
npm run dev:backend      # API on http://localhost:3001
npm run dev:frontend     # app on http://localhost:5173
```

## Running tests

Tests use a real PostgreSQL database, **never** the dev database:

- `TEST_DATABASE_URL` must be set, its database name must end in `_test`, and it must differ from
  `DATABASE_URL`; otherwise the test run refuses to start.
- Before the run, the test setup creates the `*_test` database if it is missing and applies all
  migrations to it.
- Between tests, every table is emptied with a single cascading `TRUNCATE`. Test files run serially.
- Google is replaced by a test double; the rest of the sign-in path (cookies, state check, user
  upsert, session creation) is the real code.

```bash
npm test                 # backend + frontend
```

## Commands

| Command                      | What it does                                     |
| ---------------------------- | ------------------------------------------------ |
| `npm run dev:backend`        | Start the API with reload (port 3001)            |
| `npm run dev:frontend`       | Start Vite (port 5173, proxies `/api`)           |
| `npm run db:migrate -w backend`  | Apply SQL migrations to `DATABASE_URL`       |
| `npm run db:generate -w backend` | Generate a migration from the Drizzle schema |
| `npm run typecheck`          | Type-check both workspaces                       |
| `npm run lint`               | ESLint                                           |
| `npm run format:check`       | Prettier check (`npm run format` to fix)         |
| `npm test`                   | Run backend and frontend tests                   |
| `npm run build`              | Production build of both workspaces              |
| `npm run check`              | All of the above in order                        |

## AI extraction

Saving a note stores it first, then asks the AI which todos/reminders it contains. The reply must be
JSON matching a strict schema; the backend then checks that every item is quoted from the note,
resolves dates in the **user's timezone**, and only then writes todos/reminders for that user and
note. If the AI is unavailable, slow, rate-limited or returns garbage, the note is still saved and
shows a clear message with a **Retry analysis** button. Re-saving an unchanged note never calls the
AI or creates duplicates. Re-analysis is also safe when the model **rewords** an action: a
reworded copy of something you edited, completed or deleted is recognised (by its words, strictly:
a different task is never folded in) and is not added again. Something that repeats ("every Monday
at 9am", "every weekday") becomes one repeating reminder; unsupported repetitions (every other
week, monthly, hourly) stay one-off rather than being guessed. Tests never call Gemini; they use a scripted fake provider. To check the real API by hand run
`npm run ai:smoke -w backend` (2 requests; add `-- --all` for 5). The Gemini free tier allows only
20 requests per day per model, so use it sparingly.

## Reminder alerts

There is no email or push. While the app is open, a banner (plus a count badge on the Reminders link)
lists every reminder that is **pending and whose time has arrived**. The server decides using its
clock; the browser re-checks every 30 seconds, when the tab regains focus, and at the exact moment
the next reminder is due. The alert stays until you press **Got it**, so a reload or a second tab
shows the same alerts. A reminder with no time never alerts. A date-only reminder ("tomorrow")
alerts from the start of that day in your timezone; no clock time is invented for it.

**Repeating reminders.** A reminder can repeat on chosen weekdays (every day, weekdays, or any set such as
Monday and Thursday) at its due time, kept on the wall clock of your timezone across daylight-saving
changes. `dueAt` is always its next occurrence. **Got it** on a due occurrence moves it to the next
one strictly after now (missed occurrences are not queued); a double click or second tab cannot skip
one. Choose the days in **Edit -> Repeat**, or let the AI set them from the note.

**Notifying another user.** On a reminder press **Share** and enter the email of that person's NoteFlow
(Google) account. The server resolves the email to a real, verified account (a name is never enough);
an unknown email is rejected. The recipient sees the reminder's text, time and repeat rule under
**Shared with you** and in their alert banner when it is due, and acknowledges it themselves. They
never see the source note, and cannot read, edit or delete your reminder. Editing the reminder updates
what they see; deleting it, or **Stop sharing**, removes it from their list. A reminder can be shared
with at most 10 people, and share attempts are limited to 10 a minute.

## Ask AI

Ask a question about your own notes on the **Ask AI** page. The server (never the browser or the model)
picks the notes: it searches **only your notes** with the existing PostgreSQL full-text index, ranks
them (more matching question words first, then most recently edited), and sends at most **5** notes
(each cut to 4,000 characters) with your question to the AI. The answer is validated (`{ answer,
answerable, used_notes }`), then saved with its sources: the retrieved notes the AI says it used
(positions mapped onto our own list; every retrieved note if it names none that are valid). If no note
matches, the answer is "not enough information" and the AI is not called. If the AI says the notes
are not enough, no source is shown. If the AI fails or returns unusable output, you get a clear error
and **nothing is saved**. Each user may make 4 AI calls a minute (kept under the Gemini free tier's 5 requests a minute) (note analysis and Ask AI share it); beyond that Ask AI answers 429 and a saved note simply skips analysis until you retry (per-process limit, single server). Notes and questions are treated as untrusted data (delimited by a random
per-request marker and declared as data in the system prompt). History (last 50, newest first) is
read-only and private to you; a deleted source note keeps its saved title and is no longer a link.

## API

| Method | Path                           | Auth | Notes                                              |
| ------ | ------------------------------ | ---- | -------------------------------------------------- |
| GET    | `/api/health`                  | no   | liveness                                           |
| GET    | `/api/auth/google`             | no   | start Google sign-in (`?tz=` sets a new user's timezone) |
| GET    | `/api/auth/google/callback`    | no   | finish sign-in, set session cookie, redirect home  |
| POST   | `/api/auth/logout`             | no   | deletes the server-side session; safe if signed out |
| GET    | `/api/me`                      | yes  | current user                                       |
| PATCH  | `/api/me`                      | yes  | `{ "timezone": "Europe/London" }` (IANA id)        |
| GET    | `/api/notes`                   | yes  | your notes (summaries)                             |
| POST   | `/api/notes`                   | yes  | create a note, then analyse it (`{ title, content }`) |
| GET    | `/api/notes/:id`               | yes  | full note incl. `analysis` status and counts       |
| PATCH  | `/api/notes/:id`               | yes  | edit; re-analyses only if the text changed         |
| POST   | `/api/notes/:id/analyze`       | yes  | retry a failed/pending analysis                    |
| DELETE | `/api/notes/:id`               | yes  | delete the note and what was derived from it       |
| GET    | `/api/todos`                   | yes  | your todos, open first then by due date; each has its `sourceNote` (`?status=open\|done\|all`) |
| GET    | `/api/todos/:id`               | yes  | one todo                                           |
| PATCH  | `/api/todos/:id`               | yes  | `{ title?, completed?, due? }`; `due` is `{ date, time? }` in your timezone or `null`; other fields are rejected |
| DELETE | `/api/todos/:id`               | yes  | delete a todo (an AI-created one will not come back on re-analysis) |
| GET    | `/api/reminders`               | yes  | your reminders: pending first, soonest due first, undated last; each has its `sourceNote` |
| GET    | `/api/reminders/due`           | yes  | reminders whose time has arrived (pending, `dueAt <= now`) plus `nextDueAt`; drives the in-app alert banner |
| GET    | `/api/reminders/:id`           | yes  | one reminder                                       |
| PATCH  | `/api/reminders/:id`           | yes  | `{ text?, person?, due?, recurrence?, acknowledged? }`; `due` is `{ date, time? }` in your timezone or `null`; `recurrence` is `{ days: [1..7] }` (1 = Monday) or `null`; acknowledging a due repeating reminder moves it to its next occurrence; other fields are rejected |
| DELETE | `/api/reminders/:id`           | yes  | delete a reminder (an AI-created one will not come back on re-analysis) |
| GET    | `/api/reminders/:id/shares`    | yes  | who your reminder is shared with (owner only; anyone else gets 404) |
| POST   | `/api/reminders/:id/shares`    | yes  | `{ email }` (only field accepted): share with that NoteFlow account; 404 `RECIPIENT_NOT_FOUND`, 422 `CANNOT_SHARE_WITH_SELF` / `SHARE_LIMIT` |
| DELETE | `/api/reminders/:id/shares/:shareId` | yes | stop sharing with one person                  |
| GET    | `/api/shared-reminders`        | yes  | reminders shared with you (text, time, repeat rule, sender name) plus `nextDueAt` |
| PATCH  | `/api/shared-reminders/:id`    | yes  | `{ acknowledged: true }`                           |
| DELETE | `/api/shared-reminders/:id`    | yes  | remove it from your own list (the owner's reminder is untouched) |
| POST   | `/api/ask`                     | yes  | `{ question }` (1-500 chars; other fields rejected) -> `201 { ask: { id, question, answer, status, createdAt, sources: [{ noteId, title }] } }`; `status` is `answered` or `no_info` |
| GET    | `/api/ask/history`             | yes  | your last 50 questions, newest first, each with its sources |
| GET    | `/api/ask/history/:id`         | yes  | one of your entries (anyone else's, or a malformed id, is 404) |

Errors always use `{ "error": { "code", "message" } }`. Every other `/api` route requires a session.
All `/api` responses carry `Cache-Control: no-store`. Each user is limited to 120 state-changing
requests a minute (429 `RATE_LIMITED`), in addition to the AI and sharing limits.

## Layout

```
backend/    Express API (src/, tests/, drizzle/ migrations)
frontend/   React app (src/, tests/)
docs/       Contracts and review checklist
```

## Deployment (Vercel frontend + Render API + Render PostgreSQL)

Configuration lives in `render.yaml` (API and database) and `vercel.json` (static frontend plus an `/api` rewrite).
Deployed at https://noteflow-olive.vercel.app (API on Render, reached through the Vercel rewrite). The
static app is served with a Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, a strict referrer
policy and a restrictive Permissions-Policy (`vercel.json`; the same headers are set by `nginx.conf` in Docker).

1. **Render:** create a Blueprint from this repository. It creates one PostgreSQL database and one API instance
   (`npm ci --include=dev && npm run build -w backend`; start `node backend/dist/db/migrate.js && node backend/dist/server.js`;
   health check `/api/health`). `SESSION_SECRET` is generated, `DATABASE_URL` comes from the database's internal
   connection string (no extra SSL setup), `AI_PROVIDER=groq`. Enter these in the dashboard (names only):
   `APP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GROQ_API_KEY`
   (optional `GROQ_MODEL`). Leave `ENABLE_PASSWORD_AUTH` unset.
2. **Vercel:** import the repository with the repository root as the project root (preset "Other"). Set the Render
   host in the `/api` rewrite of `vercel.json` and redeploy. The rewrite
   keeps the browser on one origin, which is required: the session cookie is `SameSite=Lax`, `HttpOnly`, `Secure` in
   production, and there is no CORS layer.
3. **Google Cloud:** set `APP_BASE_URL` to the Vercel https origin and `GOOGLE_REDIRECT_URI` to
   `<that origin>/api/auth/google/callback`; add exactly that redirect URI to the OAuth client. `APP_BASE_URL` is
   also the only origin the CSRF check accepts. While the consent screen is in "Testing", add reviewers as test users.
4. **Proxies:** `trust proxy` is not set. Only the (disabled) email/password routes use the client IP, so this does
   not affect the default configuration. If you re-enable them, set it for the real hop count first.
5. **Process-local state:** rate limits are in memory, so keep `numInstances: 1`. Sessions are in PostgreSQL.
6. Migrations are additive with no down-migration. Back up the database before applying them to anything that matters.
   Free Render databases and web services have limits (expiry, idle sleep); use paid plans for anything lasting.

## Known limitations

- Real-device mobile browsers, a deployed host, and Google account linking from Settings have not been tested.
- AI calls are made while the request waits (note save and Ask AI), with a limit per attempt (12 s Gemini, 20 s Groq) and at most one retry, only on a server or network error.
- Ask AI retrieval is keyword based (PostgreSQL full text), not semantic.
- Repeating reminders support daily, weekday and chosen-weekday schedules only (no "every other week", monthly or
  yearly). Re-analysis recognises a reworded action only when its words are very close; a rewording that adds a
  detail is treated as a new task (a deletable extra item is preferred to a hidden real task).
- Sharing notifies inside NoteFlow only (no email or push). The recipient must already have signed in once. A shared
  repeating reminder alerts the recipient every occurrence in the owner's timezone, independent of the owner's own
  acknowledgements.
- Signing in with Google inside the Docker stack needs an OAuth client that lists
  `http://localhost:8080/api/auth/google/callback`; the stack itself (build, migrations, health, headers, OAuth
  start) is verified without it.
- A reminder with no time is shown as "No time set" and never alerts.
- Live AI checks so far: one extraction and one Ask AI request against Groq on an isolated test database.
