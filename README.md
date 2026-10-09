# NoteFlow

AI notes, todos and reminders. Write notes in plain language; an AI model extracts todos and
reminders, and you can ask questions about your notes. Sign-in is Google OAuth only.

**Status:** Phases 0-6 done (foundation, auth, notes CRUD, AI intent extraction, todos, reminders, Ask AI). Phase 3's
live Gemini check is still pending (see `Memory.md`). The rest arrives in later phases (see `Phases.md`; progress in
`Memory.md`).

## Stack

React + Vite + TypeScript · Node + Express + TypeScript · PostgreSQL + Drizzle · Zod · Luxon ·
Google Gemini (behind an `AIProvider` interface) · Vitest.

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
| `GEMINI_API_KEY` / `GEMINI_MODEL`       | Gemini API key and model name (backend-only; the model is never hardcoded). If either is missing the app still runs and shows "AI analysis is not set up" on saved notes |

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

This Docker file is development infrastructure only; it is not the Docker deliverable.

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
AI or creates duplicates. Tests never call Gemini; they use a scripted fake provider. To check the real API by hand run
`npm run ai:smoke -w backend` (2 requests; add `-- --all` for 5). The Gemini free tier allows only
20 requests per day per model, so use it sparingly.

## Reminder alerts

There is no email or push. While the app is open, a banner (plus a count badge on the Reminders link)
lists every reminder that is **pending and whose time has arrived**. The server decides using its
clock; the browser re-checks every 30 seconds, when the tab regains focus, and at the exact moment
the next reminder is due. The alert stays until you press **Got it**, so a reload or a second tab
shows the same alerts. A reminder with no time never alerts. A date-only reminder ("tomorrow")
alerts from the start of that day in your timezone; no clock time is invented for it.

## Ask AI

Ask a question about your own notes on the **Ask AI** page. The server (never the browser or the model)
picks the notes: it searches **only your notes** with the existing PostgreSQL full-text index, ranks
them (more matching question words first, then most recently edited), and sends at most **5** notes
(each cut to 4,000 characters) with your question to the AI. The answer is validated (`{ answer,
answerable }`), then saved with the exact notes that were retrieved as its sources. If no note
matches, the answer is "not enough information" and the AI is not called. If the AI says the notes
are not enough, no source is shown. If the AI fails or returns unusable output, you get a clear error
and **nothing is saved**. Notes and questions are treated as untrusted data (delimited by a random
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
| PATCH  | `/api/reminders/:id`           | yes  | `{ text?, person?, due?, acknowledged? }`; `due` is `{ date, time? }` in your timezone or `null`; other fields are rejected |
| DELETE | `/api/reminders/:id`           | yes  | delete a reminder (an AI-created one will not come back on re-analysis) |
| POST   | `/api/ask`                     | yes  | `{ question }` (1-500 chars; other fields rejected) -> `201 { ask: { id, question, answer, status, createdAt, sources: [{ noteId, title }] } }`; `status` is `answered` or `no_info` |
| GET    | `/api/ask/history`             | yes  | your last 50 questions, newest first, each with its sources |
| GET    | `/api/ask/history/:id`         | yes  | one of your entries (anyone else's, or a malformed id, is 404) |

Errors always use `{ "error": { "code", "message" } }`. Every other `/api` route requires a session.

## Layout

```
backend/    Express API (src/, tests/, drizzle/ migrations)
frontend/   React app (src/, tests/)
docs/       Contracts and review checklist
```
