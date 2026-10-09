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
- [~] AI intent extraction (implemented + fully tested with a fake provider; a SUCCESSFUL live Gemini
      extraction has NOT been verified yet - see Known Issues)
- [x] Structured AI validation (parse -> Zod -> business rules -> normalize; tested)
- [x] Todos (API + UI, verified incl. live smoke; no Gemini used)
- [x] Reminders (API + UI + in-app alerts, verified incl. live smoke; no Gemini used)
- [~] Ask AI (API + UI + history, verified with a fake/scripted provider incl. live smoke; a real Gemini
      answer has NOT been observed - same quota blocker as Phase 3)
- [x] Timezone-aware AI extraction (backend resolves dates in the user's IANA tz; tested)
- [~] Duplicate prevention/reconciliation (fingerprint + reconcile in place and tested; Phase 8 adds edit-flow UI cases)
- [x] AI-created labels (shown on todos and reminders)
- [ ] Final security audit
```

Only mark a feature complete after it is implemented, integrated, and verified.

---

## 2. Current Work

### Current Phase

```text
Phase 6 (Ask AI) implemented and verified with a fake provider; Phase 3 live Gemini success check still pending quota reset
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
After the Gemini daily quota resets (~00:00 UTC) run `npm run ai:smoke -w backend` to close out Phase 3 (and try one real Ask AI question). Phase 6 changes are uncommitted until reviewed. Phase 3 = 4e8608a; Phase 4+5 = 23c4765.
```

### Status

```text
PHASE 6 VERIFIED WITH FAKE PROVIDER (uncommitted); PHASE 3 LIVE GEMINI SUCCESS STILL PENDING
```

Saving a note now stores it, then runs AI extraction; notes.analysis_status is pending|ok|failed.

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
- Phase 3 AI intent extraction: AIProvider interface + GeminiProvider (REST generateContent, key in
  x-goog-api-key header, model from GEMINI_MODEL, 12s per-attempt timeout (was 20s), one retry on 5xx/network only).
  Pipeline: provider -> JSON parse -> Zod -> business rules (evidence must be quoted from the note,
  person must be named in the note, dates resolved in user tz or dropped, <=20 items) -> fingerprint
  reconcile into todos/reminders in one transaction. No UI for todos/reminders yet.
- Env schema now reads GEMINI_API_KEY/GEMINI_MODEL (ANTHROPIC_* removed). Migration 0001 adds
  reminders.due_has_time (date-only reminders). Removed implicit $onUpdate on updated_at.
- Notes UI: AI analysis panel (counts / failure message / Retry analysis). POST /api/notes/:id/analyze.
- Phase 4 Todos: GET /api/todos (?status=open|done|all; open first, due asc, undated last; each row has
  sourceNote {id,title} via an ownership-scoped join), GET/PATCH/DELETE /api/todos/:id. No POST (todos
  come from AI extraction). No migration needed (todos schema already had completed/completed_at/
  user_modified; source_note_id is NOT NULL + cascade, so a todo always has its note).
  PATCH body is strict {title?, completed?, due?}; `due` = {date, time?} in the USER's timezone (server
  converts) or null. Editing text/due sets user_modified; toggling completion does not. DELETE of an
  AI-created todo writes an ai_dismissed tombstone (so it never returns on re-analysis).
  UI: /todos page (nav link in the shell), checkbox, inline edit (text + date + optional time, sends only
  changed fields), two-step delete, All/Open/Completed filter, AI-created badge, "From note: <title>" link,
  Overdue flag, date-only dues shown as a date with no time. Deleting a todo also refreshes note counts.
- Phase 5 Reminders (no migration: reminders already had status/alerted_at/due_has_time):
  GET /api/reminders (pending first, due asc, undated last, handled last; each with sourceNote),
  GET /api/reminders/due -> {reminders, nextDueAt} (pending AND due_at <= server now; never undated),
  GET/PATCH/DELETE /api/reminders/:id. No POST (AI-created, like todos).
  PATCH body strict {text?, person?, due?, acknowledged?}; blank person -> null; `due` = {date,time?} in the
  USER's tz (date-only = START of the local day, no time invented) or null; acknowledged true -> status
  'acknowledged' + alerted_at=now, false -> pending. Editing text/person/due sets user_modified; a changed
  due re-arms the alert (back to pending). DELETE of an AI-created reminder writes an ai_dismissed tombstone.
  Shared backend/src/lib/dueInput.ts now backs todo and reminder due parsing (Luxon, DST-aware);
  frontend components/DueFields.tsx is shared by both edit forms (clearing the date also clears the time).
  In-app alerts: DueAlerts banner + nav badge in the shell on EVERY page, fed by /reminders/due; polled
  every 30s, on tab focus, and via a timer at nextDueAt (+0.5s). Stays until "Got it", so reloads and
  second tabs show the same alerts (no repeated pop-ups). Fetch errors are silent. "Person" is
  informational only; nobody is notified. /reminders page groups: Due now / Upcoming / No time set /
  Acknowledged, with edit, delete (two-step), Got it / Re-open, source-note link.
- Live smoke (temp users, since deleted): HTTP CRUD, cross-user 404s, and UI create/edit/delete
  in the browser pane all worked.
- Phase 6 Ask AI (no migration: ask_history + ask_history_sources + the notes GIN full-text index already existed):
  POST /api/ask {question} -> 201 {ask:{id,question,answer,status,createdAt,sources:[{noteId,title}]}};
  GET /api/ask/history (last 50, newest first); GET /api/ask/history/:id (foreign/malformed -> 404).
  Body is strict {question} (trimmed, 1-500 chars, no NUL); user_id, note ids, sources etc. -> 422.
  Retrieval (modules/ask/ask.repo.ts): question -> distinct lowercase words (max 12) -> each bound as
  plainto_tsquery('english', $n) and OR-ed -> `to_tsvector('english', title||' '||content) @@ query` (uses the
  existing GIN index), scoped by user_id, ordered ts_rank_cd desc, updated_at desc, id asc, LIMIT 5, each note
  cut to 4,000 chars. No embeddings/vector DB.
  AI (ai/ask/{schema,prompt,answerer}.ts, via AIProvider): reply must be {answer<=4000, answerable:boolean};
  parse (fence stripped) -> Zod; extra keys (e.g. invented source ids) are dropped. Notes and question are
  delimited by random per-request markers and declared UNTRUSTED in the system prompt.
  Sources are the notes the BACKEND retrieved, never model/client ids. No matching note -> deterministic
  "not enough information" (status no_info, no AI call, saved). Model says answerable=false -> status no_info
  and NO sources saved/shown. Provider/validation failure -> mapped 429/502/503/504/422 with a safe message,
  NOTHING saved (status 'failed' exists in the enum but is intentionally unused).
  History: entry + sources saved in one transaction; ask_history_sources keeps a title snapshot, note_id is
  SET NULL on note delete, so history still reads correctly (shown as "(note deleted)", not a link). A
  renamed note shows its current title. Read-only: no edit/delete endpoints. Source join is ownership-scoped.
  UI: /ask page + "Ask AI" nav link: question box (counter, validation), Question -> Answer -> Sources used
  (links to /notes/:id), history list (select to review, no API call), loading/error/empty states.
  Ask answers are rendered as text (never HTML).
- Phase 6 live smoke (real server + real dev DB + a scripted local AI that never touches the network; temp
  users/notes, since deleted): 401s, user_id 422, foreign Origin 403, ask via UI, answer + source link opens
  the right note, history survives reload, history item selection, provider failure -> safe error with the
  question kept and nothing saved, user B sees an empty history and gets 404 for A's entry, and the prompt
  sent to the AI never contained B's note. No Gemini request was made.
```

---

## 4. Known Issues / Blockers

```text
- Phase 3 live verification: a SUCCESSFUL real Gemini extraction has not been observed. Evidence:
  (1) minimal-schema calls returned 200 with JSON; (2) the full extraction request returned 400
  INVALID_ARGUMENT on the first live run, before I removed nullable-integer and maxItems from the JSON
  Schema (suspected cause, unconfirmed); (3) the free-tier quota then returned 429 for every call.
  Failure paths were verified live (503/429 -> note saved, clear message, nothing stored).
  Next action: after the quota resets run `npm run ai:smoke -w backend` (2 requests; `-- --all` = 5)
  and confirm valid items; if it still 400s, bisect the schema (enum / type arrays) ONE request at a time.
- Phase 4 limitation: todo due dates edited by the user are interpreted in the account timezone (PATCH /me);
  there is no timezone picker UI yet (Phase 7/9). Date-only reminders are not shown anywhere yet.
- Phase 5 live smoke (temp rows, since deleted; no notes created, no Gemini): API 401/404/422/403 cases,
  banner + badge on the Notes page, date-only alert without a time, acknowledge persisted across reload,
  edit (person/due), delete + tombstone, and an alert appearing by itself 0.5s after its due time with
  no page reload.
- Phase 5 limitations: alerts only show while the app is open (no email/push by design); the Reminders
  link badge/banner depend on the 30s poll if the timer is throttled in a background tab; a date-only
  reminder alerts from the start of its day; manual due edits use the account timezone (no picker yet).
- Post-Phase-6 hardening (from the Ponytail review/audit; uncommitted until reviewed):
  (1) Per-user AI rate limit, lib/rateLimit.ts: sliding window, 10 real AI calls per user per minute,
  one shared allowance for note analysis and Ask AI, checked just before the provider is called (an Ask
  with no matching note costs nothing and is not counted). Ask over the limit -> 429 AI_RATE_LIMITED, no
  AI call. Saving/editing a note still succeeds; its analysis is marked failed with a "retry shortly"
  message; POST /notes/:id/analyze -> 429. shortcut: per-process; move to a shared store when running more
  than one server. It limits one user's rate; it does NOT guard Gemini's daily quota (20/day free tier).
  (2) Ask AI delete race: saveAsk re-reads which retrieved notes still exist (user-scoped) inside its
  transaction and saves only those sources, so deleting a note while the AI works no longer causes a 500.
  (3) GeminiProvider default timeout 20s -> 12s (worst case ~25s with the one 5xx retry, under typical
  30s proxy limits). (4) Retrieval ranks with ts_rank_cd(..., 1) (length normalization) so long notes do
  not win by length alone. (5) Stale docs/comments about Gemini/Anthropic corrected.
  Deferred on purpose: ask history retention, 500-item list cap/pagination, session cleanup for other
  users, Todo/Reminder component dedup, vector search/embeddings/synonyms, a shared rate limiter.
- Phase 7 date/time audit (verified by tests that assert stored UTC instants; no Gemini used):
  Architecture found sound and unchanged: Luxon everywhere on the server, UTC `timestamptz`, the browser
  sends local {date,time?} (never instants), shared lib/dueInput.ts for todos+reminders, Intl formatting in
  the account timezone on the frontend. Verified: Asia/Kolkata 2026-10-09 17:00 -> 11:30Z (also the legacy id
  Asia/Calcutta the dev account stores); 00:00/23:59 cross the UTC day correctly; date-only = no time
  (todo: end of local day, reminder: start); America/New_York spring-forward day (23h) and fall-back day
  (25h); gap time 02:30 -> 03:30 EDT; ambiguous 01:30 -> first (EDT) occurrence; leap day ok, 2027-02-29
  refused; reminder alerts fire at the exact instant (07:30:00.000Z, not 1ms earlier) across a DST change;
  "in two hours" is elapsed time. Account tz: set once at first sign-in from the browser, never overwritten,
  invalid -> UTC, PATCH /me validated; raw timestamps/offsets/user_id in due payloads -> 422.
  Bugs found and fixed: (1) note timestamps (list + detail) were formatted with the BROWSER's timezone and
  locale by a second formatter (NoteList.formatDate); they now use the shared formatDateTime in the account
  timezone. (2) AI-extracted "T24:00" was silently read by Luxon as the next day's midnight; hour 24 is now
  rejected (the date is dropped, never guessed), matching the manual-entry rule. Also removed a duplicate
  ResolvedDue type. Limitations: no timezone picker (a user whose first sign-in had no valid browser tz stays on
  UTC until PATCH /me is used); a time inside the DST gap is stored as the shifted time and shown that way; the
  second occurrence of a fall-back hour displays the same HH:mm as the first and re-saving it picks the first.
- Phase 6 limitations: retrieval is keyword-based (stemming, no synonyms/typo tolerance, title not weighted);
  a question whose words appear in no note gets "not enough information" even if a paraphrase exists; only
  the top 5 notes (4,000 chars each) are considered; history is capped at 50 entries and cannot be deleted;
  no streaming and no per-user rate limit on Ask AI.
- Gemini free tier allows only 20 requests/day/model. Every note save and Ask AI question costs one, so
  demos/tests of the real app can exhaust it. Consider a billed key or a second model for later phases.
  429s are no longer retried (a retry only burns quota); daily-quota 429s show a distinct message.
- Gemini returns 503 "high demand" intermittently for gemini-3.8-flash; handled by one retry.
```

The Gemini provider is integrated (AIProvider -> GeminiProvider -> Gemini API, used by extraction and Ask AI). It has only been exercised with fakes and mocked HTTP: no successful live Gemini extraction or Ask AI answer has been observed yet.

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
- Extraction dates: model returns user-local wall-clock strings; backend converts with Luxon. Backend
  supplies the calendar (today/tomorrow/weekday lookup). "Friday" = first Friday strictly after today;
  "next Friday" = Friday of the following calendar week (weeks start Monday).
- Date-only: todos stored as END of local day, reminders as START of local day, due_has_time=false.
  Reminder with no date/time: due_at NULL. Relative ("in two hours") = now + minutes.
- Fingerprint = kind + normalized text + person (+ occurrence index); due date is NOT part of it, so a
  changed date updates the item in place. User-modified / completed / handled items are never deleted;
  tombstones (ai_dismissed) stop deleted items returning. Stale analyses (note edited meanwhile) are
  discarded via a row lock + updated_at check.
- Unchanged re-save = no AI call and no updated_at bump; failed/pending notes are retried on re-save.
  POST /:id/analyze never re-calls the AI for an already-ok note (quota protection).
- Gemini JSON schema avoids nullable numerics and maxItems (due_relative_minutes is a plain integer,
  0 = not relative); the 50-item cap lives in Zod. Thought parts of Gemini replies are ignored.
```

---

## 6. Tests / Verification

Latest verified state (end of Phase 5):

```text
Backend:
- 408 tests passed (327 earlier + 81 reminders API tests)
- Mutation spot-checks: removing evidence grounding, the stale-analysis guard, the time-guess guard, todo ownership scoping, the delete tombstone, strict() on PATCH, reminder ownership scoping, or the due query's status/user filters each makes tests fail

Frontend:
- 122 tests passed (80 earlier + 42 reminders UI + alerts)

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
Phase 3 — AI intent extraction                     [~] code done, live Gemini success unverified
Phase 4 — Todos                                    [x] (uncommitted)
Phase 5 — Reminders                                [x] (uncommitted)
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
