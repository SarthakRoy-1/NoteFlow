# NoteFlow

AI notes, todos and reminders. Write notes in plain language; an AI model extracts todos and
reminders, and you can ask questions about your notes. Sign-in is Google OAuth only.

**Status:** Phase 0 (project foundation). The app scaffolding runs; features arrive phase by phase
(see `Phases.md`, progress in `Memory.md`).

## Stack

React + Vite + TypeScript · Node + Express + TypeScript · PostgreSQL + Drizzle · Zod · Luxon ·
Anthropic Claude (behind a provider interface) · Vitest.

## Prerequisites

- Node.js 20.12+ and npm 10+
- PostgreSQL (needed from Phase 1)

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
```

### Environment variables

| Variable                                                          | Purpose                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`                                                        | `development`, `test` or `production`                    |
| `PORT`                                                            | API port (default 3001)                                  |
| `APP_BASE_URL`                                                    | Frontend origin (default `http://localhost:5173`)        |
| `SESSION_SECRET`                                                  | Random string, 32+ characters                            |
| `DATABASE_URL`                                                    | PostgreSQL connection URL                                |
| `TEST_DATABASE_URL`                                               | Separate database used by integration tests (Phase 1+)   |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth client (Phase 1)                            |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`                           | Claude API (Phase 3). If missing, the app reports a clear error |

Generate a session secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Commands

| Command                  | What it does                                  |
| ------------------------ | --------------------------------------------- |
| `npm run dev:backend`    | Start the API with reload (port 3001)         |
| `npm run dev:frontend`   | Start Vite (port 5173, proxies `/api`)        |
| `npm run typecheck`      | Type-check both workspaces                    |
| `npm run lint`           | ESLint                                        |
| `npm run format:check`   | Prettier check (`npm run format` to fix)      |
| `npm test`               | Run backend and frontend tests                |
| `npm run build`          | Production build of both workspaces           |
| `npm run check`          | All of the above in order                     |

## Layout

```
backend/    Express API (src/, tests/)
frontend/   React app (src/, tests/)
docs/       Contracts and review checklist
```
