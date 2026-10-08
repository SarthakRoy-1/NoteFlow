# NoteFlow

AI notes, todos and reminders. Write notes in plain language; an AI model extracts todos and
reminders, and you can ask questions about your notes. Sign-in is Google OAuth only.

**Status:** Phases 0-3 complete (foundation, auth, notes CRUD, AI intent extraction). Todos and
reminders screens, Ask AI and the rest arrive in later phases (see `Phases.md`; progress in
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

Errors always use `{ "error": { "code", "message" } }`. Every other `/api` route requires a session.

## Layout

```
backend/    Express API (src/, tests/, drizzle/ migrations)
frontend/   React app (src/, tests/)
docs/       Contracts and review checklist
```
