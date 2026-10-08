# Project Memory

> This file is intentionally lightweight at project start.
>
> The coding agent should update it regularly as implementation progresses.

## 1. What Has Been Completed

Record only work that is actually complete and verified.

Use the assignment priority when tracking progress:

```text
P0 — Core / Required
- [x] Repository inspection (greenfield; docs only)
- [~] Google OAuth (full flow + sessions built and tested with a Google test double;
      NOT yet exercised against real Google — needs credentials in .env)
- [x] Database schema (8 tables, SQL migration applied to dev + test DBs)
- [ ] Notes CRUD
- [ ] AI extraction + structured validation
- [ ] Todos
- [ ] Reminders + in-app alerts
- [ ] Ask AI + history
- [ ] Error and edge-case handling

P1 — Should Have
- [ ] Timezone support
- [ ] Duplicate prevention
- [ ] AI-created labels

P2 — Bonus / Optional
- [ ] Unclear reminder handling
- [ ] Recurring reminders
- [ ] Notify another user
- [ ] Smarter Ask AI retrieval
- [ ] Docker
```

Only mark a feature complete after it is implemented, integrated, and verified.

---

## 2. Current Work

### Current Phase

```text
Phase 1 complete (Foundation); next: Phase 2 — Notes
```

### Current Feature

```text
None
```

### Current File

```text
None
```

### Current Objective

```text
Phase 2: Notes CRUD (backend ownership-scoped + frontend UI), no AI yet.
```

### Status

```text
PHASE 1 VERIFIED — awaiting go-ahead for Phase 2
```

---

## 3. Recently Completed

Record the most recent completed work.

```text
- Phase 0: git init, .gitignore (before any env file), .env.example (names only),
  npm workspaces monorepo, strict TS, ESLint+Prettier, Vitest.
- Backend foundation: Express 5 app factory, Zod env validation, AppError + error envelope,
  JSON logger, GET /api/health. 6 tests.
- Frontend foundation: Vite+React+TS, Router, TanStack Query provider, Design.md tokens
  (light/dark), home page. 1 test.
- docs/07_FINAL_REVIEW_CHECKLIST.md created; README with setup + env table.
- Phase 1: Drizzle schema + SQL migration 0000_init (users, sessions, notes, todos, reminders,
  ai_dismissed, ask_history, ask_history_sources); composite FK (source_note_id,user_id) ->
  notes(id,user_id) so derived rows can never point at another user's note.
- Sessions: 256-bit random token, only SHA-256 hash stored, httpOnly + SameSite=Lax cookie
  (Secure in production), expiry enforced, logout deletes the row.
- Google OAuth (openid-client): code flow + PKCE S256 + state + nonce + ID-token verification;
  transient signed oauth cookie; upsert by google_sub; failures redirect to /login?error=<code>.
- requireAuth, GET/PATCH /api/me (IANA timezone validated with Luxon), POST /api/auth/logout,
  Origin check on state-changing requests, helmet.
- Frontend: login page with error messages, RequireAuth, home with sign-out.
- Test DB strategy: TEST_DATABASE_URL (*_test, must differ from DATABASE_URL), auto-created +
  migrated in globalSetup, TRUNCATE CASCADE between tests, files serial.
- Dev Postgres via docker-compose.dev.yml (container noteflow-dev-db).
```

---

## 4. Known Issues / Blockers

Record real blockers only.

```text
- None
```

Each blocker should include:

- issue
- affected feature
- evidence/error
- attempted fix
- next action

---

## 5. Decisions Made

Record important architectural or product decisions.

```text
- Monorepo with npm workspaces; ESM everywhere; backend uses NodeNext (.js import suffixes).
- Vitest 5 + react-router-dom 7 chosen so `npm audit` reports 0 vulnerabilities.
- DATABASE_URL and SESSION_SECRET are required at boot; Google/Anthropic vars optional so the
  app can report "not configured" to users instead of crashing.
- Dev: Vite proxies /api to :3001 (same-origin cookies).
- Phase order deviation planned: Phase 7 (timezone) built together with Phase 3 (extraction).
- Dev DB: Postgres 16 in Docker (docker-compose.dev.yml); password from local .env only.
- sessions.id = SHA-256(token). Unknown /api paths return 401 when signed out (no route leakage).
- OAuth failures are redirects to {APP_BASE_URL}/login?error=<code>; codes: not_configured,
  access_denied, invalid_state, login_failed, email_unverified.
- Browser timezone passed as ?tz= at login; applied only when the user row is first created.
- PATCH /me body is strict: unknown keys (e.g. user_id) -> 422.
- Timezone validation: 'UTC' or Region/City that Luxon accepts (rejects 'EST', offsets).
- ask_history.status enum: answered | no_info | failed.
- drizzle-orm is also a root devDependency so drizzle-kit (hoisted) can resolve it;
  root package.json `overrides` pins esbuild ^0.25 (clears a dev-tool advisory in drizzle-kit deps).
```

Examples:

- selected AI provider
- database strategy
- authentication strategy
- date/time storage convention
- idempotency strategy

---

## 6. Tests / Verification

Record the latest verification state.

```text
Frontend:
- 9/9 tests pass

Backend:
- 74/74 tests pass (real Postgres test DB)

Typecheck:
- Clean (both workspaces)

Lint/format:
- Clean

Build:
- Both workspaces build; built API boots and serves /api/health
```

Update this after meaningful implementation milestones.

---

# Memory Maintenance Rules

1. Update after completing a meaningful phase.
2. Update when changing the current file/feature.
3. Update when discovering a blocker.
4. Update when making an architectural decision.
5. Update test/build status after verification.
6. Do not fill this file with general documentation already covered elsewhere.
7. Do not mark unfinished work as complete.
8. Keep entries concise and factual.
9. Preserve historical decisions when they matter.
10. The latest state in this file must reflect the actual repository state.
