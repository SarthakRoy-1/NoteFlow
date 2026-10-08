# Project Memory

> This file records the current verified state of the NoteFlow project.
>
> Update it after meaningful implementation milestones. Keep it concise and factual.

## 1. What Has Been Completed

```text
- [x] Repository inspection and project foundation
- [x] Phase 0 scaffold/tooling
- [x] Phase 1 database schema and migrations
- [x] Phase 1 authentication/session foundation
- [x] Real Google OAuth login tested
- [x] Logout tested
- [x] Unauthenticated API rejection verified
- [x] Per-user authorization foundations verified
- [x] PostgreSQL development database running
- [x] Gemini API key created and stored locally
- [x] .env.example updated to Gemini configuration
- [x] Notes CRUD (backend + UI, verified)
- [ ] AI intent extraction
- [ ] Structured AI validation
- [ ] Todos
- [ ] Reminders
- [ ] Ask AI
- [ ] Timezone-aware AI extraction
- [ ] Duplicate prevention/reconciliation
- [ ] AI-created labels
- [ ] Final security audit
```

Only mark a feature complete after it is implemented, integrated, and verified.

---

## 2. Current Work

### Current Phase

```text
Phase 2 complete (Notes CRUD); next: Phase 3 — AI intent extraction
```

### Current Feature

```text
None (between phases)
```

### Current File

```text
None
```

### Current Objective

```text
Phase 3: AIProvider abstraction + GeminiProvider, structured extraction with validation, timezone-aware dates (Phase 7 merged in). Not started.
```

### Status

```text
PHASE 2 VERIFIED — awaiting go-ahead for Phase 3
```

AI extraction is not implemented yet. Saving a note does not call any AI; notes.analysis_status stays 'pending' until Phase 3.

---

## 3. Recently Completed

```text
- Phase 0 repository/scaffold/tooling completed.
- Phase 1 database schema and migrations completed.
- Phase 1 authentication/session foundation completed.
- Real Google OAuth login successfully tested against Google.
- /api/me returned the authenticated Google user successfully.
- Logout successfully invalidated the session.
- /api/me returned 401 after logout.
- PostgreSQL 16 development container is healthy.
- Database migrations applied successfully.
- Backend and frontend checks pass.
- npm audit reports 0 vulnerabilities.
- Gemini API key was created for the NoteFlow Google Cloud project.
- The real Gemini key is stored only in the local .env and is not committed.
- .env.example now uses GEMINI_API_KEY and GEMINI_MODEL.
- Phase 2 Notes CRUD: GET/POST /api/notes, GET/PATCH/DELETE /api/notes/:id, all behind
  requireAuth; every repo query is scoped by the session user id (no unscoped id lookups).
  Foreign or malformed ids -> 404; unknown body keys (incl. user_id) -> 422. No migration needed.
- Notes UI: two-pane list/detail on desktop, single pane on mobile; create, view, inline edit,
  two-step delete; loading/empty/error states; note text rendered as plain text.
- Live smoke (temp users, since deleted): HTTP CRUD, cross-user 404s, and UI create/edit/delete
  in the browser pane all worked.
```

---

## 4. Known Issues / Blockers

```text
- None currently blocking Phase 2.
```

The Gemini API has not yet been integrated into application code. The provider abstraction and Gemini implementation are planned for the AI extraction phase.

---

## 5. Decisions Made

```text
- React + Vite + TypeScript is the frontend stack.
- Node.js + Express + TypeScript is the backend stack.
- PostgreSQL is the database.
- Drizzle ORM is used for database access and migrations.
- Google OAuth is the only authentication method required by the assignment.
- Sessions are server-managed and authenticated requests derive the user from the session.
- User-owned data must always be scoped by authenticated user ownership.
- Gemini is the selected AI provider for this implementation.
- The AI provider is accessed through an AIProvider abstraction and GeminiProvider implementation.
- Gemini SDK calls must not be placed directly in business/domain logic.
- GEMINI_API_KEY is backend-only.
- GEMINI_MODEL is configured through environment variables.
- Current configured model value is gemini-3.8-flash.
- Structured AI output follows parse → schema validation → business validation → normalization → persistence.
- AI output is never trusted as an authority for authentication, ownership, authorization, or source-note validity.
- AI/provider failure must not cause a valid saved note to disappear.
- Natural-language dates must be interpreted using the user's timezone.
- PostgreSQL stores canonical timestamps.
- Local Docker PostgreSQL is development infrastructure; using Docker locally does not by itself count as completing the assignment's optional Docker submission bonus.
- The assignment source document must remain unchanged; implementation choices belong in project documentation.
- Notes validation: title trimmed 1-200 chars, content trimmed 1-20,000 chars; both required.
  Server is authoritative; frontend mirrors limits in features/notes/notesApi.ts.
- List endpoint returns summaries (id, title, 160-char preview, timestamps); GET one returns full note.
  Responses never include user_id. List capped at 500 newest-updated.
- Cross-user access returns 404 (not 403) so note existence is not revealed.
- Delete is a hard delete; FK cascades will remove derived todos/reminders in later phases.
- Frontend routes: /notes, /notes/new, /notes/:id; / redirects to /notes. HomePage replaced by AppShell.
- Env schema still lists ANTHROPIC_* and does not yet read GEMINI_* (intentionally untouched in
  Phase 2; switch to Gemini config in Phase 3).
```

---

## 6. Tests / Verification

Latest verified state (end of Phase 2):

```text
Backend:
- 117 tests passed (74 from Phase 1 + 43 notes tests)

Frontend:
- 31 tests passed (10 auth + 21 notes)

Typecheck:
- Passed

Lint:
- Passed

Formatting:
- Passed

Production build:
- Passed

Database migration:
- Passed

PostgreSQL smoke test:
- Passed

Google OAuth:
- Real login passed
- Authenticated /api/me passed
- Logout passed
- Unauthenticated /api/me returned 401

Security checks:
- Session cookie protections implemented
- OAuth state/PKCE/nonce protections implemented
- Protected API routes reject unauthenticated requests
- Cross-user ownership constraints implemented

Dependency audit:
- 0 vulnerabilities

Git:
- Working tree was clean after the completed Phase 1 commits
```

The Gemini API key itself has not been pasted into source control or documentation.

---

## 7. Phase Order

```text
Phase 0 — Scaffold/tooling                         [x]
Phase 1 — DB/auth foundation                       [x]
Phase 2 — Notes CRUD                               [x]
Phase 3 — AI intent extraction                     [ ]
Phase 4 — Todos                                    [ ]
Phase 5 — Reminders                                [ ]
Phase 6 — Ask AI                                   [ ]
Phase 7 — Timezone support                         [ ]
Phase 8 — Idempotency/reconciliation              [ ]
Phase 9 — UX/design refinement                     [ ]
Phase 10 — Security/reliability audit              [ ]
Phase 11 — Test/build gate                         [ ]
Phase 13 — Final submission review                 [ ]
```

Optional bonus work should only begin after all mandatory core and "Should have" requirements are stable.

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
