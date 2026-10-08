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
- [ ] Google OAuth
- [ ] Database schema
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
Phase 0 complete; next: Phase 1 — Foundation
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
Inspect the repository and determine the existing frontend, backend, database,
authentication, AI provider, tests, and deployment setup before selecting or
changing implementation technologies.
```

### Status

```text
PHASE 0 VERIFIED — awaiting go-ahead for Phase 1
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
- No Postgres client installed locally (no psql); Docker is available — decide DB provisioning in Phase 1.
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
- 1/1 tests pass

Backend:
- 6/6 tests pass (no DB tests yet)

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
