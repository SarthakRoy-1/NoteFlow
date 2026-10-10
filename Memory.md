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
- Env schema now reads GEMINI_API_KEY/GEMINI_MODEL (the earlier provider variables were removed). Migration 0001 adds
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
  Sources are the notes the BACKEND retrieved, never model/client ids; the model only returns `used_notes` (1-based positions in the numbered list it was given), which are mapped onto our own list (out-of-range/repeated ignored; none valid -> all retrieved notes). `used_notes` is covered by mocks only, never tried against real Gemini. No matching note -> deterministic
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
  (1) Per-user AI rate limit, lib/rateLimit.ts: sliding window, 4 real AI calls per user per minute (was 10; lowered to fit the Gemini free tier's 5 RPM),
  one shared allowance for note analysis and Ask AI, checked just before the provider is called (an Ask
  with no matching note costs nothing and is not counted). Ask over the limit -> 429 AI_RATE_LIMITED, no
  AI call. Saving/editing a note still succeeds; its analysis is marked failed with a "retry shortly"
  message; POST /notes/:id/analyze -> 429. shortcut: per-process; move to a shared store when running more
  than one server. It limits one user's rate; it does NOT guard Gemini's daily quota (20/day free tier).
  (2) Ask AI delete race: saveAsk re-reads which retrieved notes still exist (user-scoped) inside its
  transaction and saves only those sources, so deleting a note while the AI works no longer causes a 500.
  (3) GeminiProvider default timeout 20s -> 12s (worst case ~25s with the one 5xx retry, under typical
  30s proxy limits). (4) Retrieval ranks with ts_rank_cd(..., 1) (length normalization) so long notes do
  not win by length alone. (5) Stale docs/comments about earlier provider choices corrected.
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
- Frontend visual polish (CSS only, no markup/behaviour change):
  todo/reminder rows are content-first with quiet inline actions (stacked on phones, 40px targets);
  `--color-on-accent` fixes low-contrast text on the pale dark-theme primary/danger fills; buttons got
  hover (pointer devices only) and a 0.97 press state; native controls/selection follow the theme
  (`color-scheme`, `accent-color`, `::selection`); tabular numerals on dates/counts; the due-alert banner
  eases in (respects prefers-reduced-motion). Checked in a real browser at desktop dark, mobile light.
  Not done: a separate product-context document and a reference-site analysis.
- Frontend completion batch (no Gemini; real backend + scripted AI only for browser checks):
  (1) Session expiry: a 401 from any query/mutation while signed in clears cached private data and sends the
  user to /login?error=session_expired with a clear message (RequireAuth). Checked against the real backend by
  deleting the session row. (2) Note page lists the todos/reminders created from it (DerivedItems); note
  create/edit/retry/delete now refresh the todo and reminder caches. (3) /settings: account time zone
  (PATCH /me), linked from the account name in the header; a "use this device's zone" shortcut; saving
  re-renders every date. Intl lists Asia/Calcutta (not Asia/Kolkata); both are valid for the backend.
  (4) Login page styled and explained. Reference-site analysis still pending (needs a reference URL).
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
- Google OAuth is the authentication method required by the assignment. Email/password was added later by change request (see "Email/password authentication" below).
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

## Frontend redesign (warm paper-and-ink)

- Direction and tokens are documented in `Design.md` and `PRODUCT.md`; colours live in `frontend/src/styles/tokens.css` as `light-dark()` pairs, the theme control (System/Light/Dark, `lib/theme.ts`) only sets `color-scheme`.
- Fonts are self-hosted (`@fontsource-variable/newsreader`, `@fontsource-variable/instrument-sans`).
- Layout: sidebar + note list + writing pane; phones use a bottom tab bar and one Notes pane at a time.
- Verified with scripted-AI sample data; zero Gemini requests. Live Gemini verification is still a separate step.

## Email/password authentication, verification, linking and recovery

- **Phase 1 (assignment compliance): this whole feature is DISABLED by default** via `ENABLE_PASSWORD_AUTH` (`config/env.ts`, default `false`, only the exact string `true` enables it). When off, `app.ts` does not mount `passwordAuthRouter` or `linkRouter`, answers register/login/resend-verification/verify-email/forgot-password/reset-password/link/* with the standard 404 envelope (no email sender built, no DB access), and the Google callback ignores stored link attempts. `GET /api/auth/config` always exists and returns `{ passwordAuthEnabled, emailEnabled }`; the frontend hides the email form, the three token pages (redirect to `/login`) and the Settings sign-in-methods panel from it. Code, migrations and data are untouched, so setting the flag to `true` restores the behaviour described below.

- Auth routes: `backend/src/auth/password.routes.ts` (register, resend-verification, verify-email, login, forgot-password, reset-password, GET /config), `auth/link.routes.ts` (Connect Google), shared token/DB helpers in `auth/accountTokens.ts`, hashing in `auth/password.ts` (Argon2id, 19 MiB / 2 passes / 1 lane, NFKC). Email: `backend/src/email/` (`EmailSender`; Resend over fetch, or SMTP via nodemailer for Gmail App Passwords; unconfigured sender throws `not_configured`). Env: `EMAIL_PROVIDER=smtp` + `SMTP_HOST/PORT/SECURE/USER/PASS` + `EMAIL_FROM`, or `RESEND_API_KEY` + `EMAIL_FROM`. An explicit `EMAIL_PROVIDER` with missing variables keeps email off and logs a startup warning naming the missing variables (never values); no provider means email features are off. SMTP errors are reduced to a kind, never logged or forwarded.
- **Sign-up never creates an account until verified.** `POST /register` stores a `pending_registrations` row (email, name, Argon2id hash, token hash, 24 h expiry) and emails a link `…/verify-email#token=…` (token in the fragment so it is never sent to servers or Referer). The pending row is not an account, cannot sign in, and does not reserve the address, so it can never block the real owner's Google sign-in. Latest sign-up for an address replaces the earlier one. Responses are identical for new and already-registered addresses (an existing owner gets an "already have an account" email instead).
- `POST /verify-email` needs the token AND the password chosen at sign-up (so an attacker who overwrites a victim's pending record cannot get the victim to complete it). The pending row is deleted and the user inserted in one transaction (single use, race-safe); the user is created with `email_verified_at`. Per-token and per-IP attempt limits apply.
- `requireAuth` returns 403 `EMAIL_NOT_VERIFIED` for any user without `email_verified_at` (defence in depth; only pre-0003 password accounts can be in that state). Those accounts can verify through resend-verification (`user_tokens`, purpose `verify_email`) or a password reset.
- **Recovery:** `forgot-password` (generic 202; only password accounts get a link) and `reset-password` (token hash, 1 h, single use). A reset sets the password, marks the email verified, and deletes every session of the account. No automatic sign-in after reset.
- **Linking Google:** `POST /api/auth/link/google/start` (signed in + password re-entered) stores a one-time hashed OAuth state in `oauth_link_attempts`, bound to the user and the exact session (deleting the session deletes the attempt). Google redirects to the existing `/api/auth/google/callback`, which first checks whether `state` is a stored link attempt, consumes it atomically, requires the same user and session, a verified Google email, and a Google identity not linked elsewhere, then sets `google_sub` on that one account. Results land on `/settings?link=ok|<error>`. A Google sign-in for an email owned by a password account is refused (`?error=email_in_use`), never merged.
- Migrations: `0002_email_password_auth` (nullable `google_sub`, `password_hash`, auth-method check, `lower(email)` unique) and `0003_email_verification_linking_recovery` (`users.email_verified_at`, `pending_registrations`, `user_tokens`, `oauth_link_attempts`; backfills `email_verified_at` for accounts with a Google identity). Both additive. Rollback is manual SQL (drop the new tables/column; restore `google_sub NOT NULL` only if no password-only users exist).
- Rate limits are per process: sign-up/resend 5/h/IP, 3 emails/h/address, login 20/15 min/IP and 8/15 min/email, forgot 5/h/IP, token submissions 20/15 min/IP and 5/15 min/token, link start 5/15 min/user.
- Limitations: real email delivery and real Google linking have not been exercised (fake providers in tests); no CAPTCHA or breached-password check; Google-only accounts cannot add a password; pre-0003 password accounts that were never verified still hold their email until verified or reset.

## Stabilization run (9 Oct 2026)

- Fixed: blank `EMAIL_PROVIDER`, `SMTP_PORT`, `SMTP_SECURE`, `PORT`, `APP_BASE_URL` and `SESSION_TTL_DAYS` (exactly what `.env.example` ships) crashed startup; blank now means "not set" (`config/env.ts`, tested against the real `.env.example`).
- Live browser QA on an isolated `noteflow_test` database with Gemini and email switched off (throwaway users, never the dev DB): sign in by password form, notes create/edit/validation/reload/isolation, AI-failure message with the saved note and existing todo/reminders intact, todos done/undone/edit/delete/source link, reminders alert/acknowledge/re-open/edit/delete/no-time-no-alert, IST display, cross-user 404 on read/patch/delete/analyze, logout and 401 on every protected route.
- Not verified live: real Gemini extraction and Ask AI (quota), Google linking from Settings, responsive layouts on a device, hosted deployment.
- Real email sign-up verification and password reset over Gmail SMTP were exercised by the owner (database showed verified users and a consumed reset token).

## Groq provider (added after the stabilization run)

- `backend/src/ai/provider/groq.ts` (`GroqProvider`, OpenAI-compatible `chat/completions`, strict `json_schema` response format, `reasoning_effort: low`, `include_reasoning: false`, key in the Authorization header only). `toStrictSchema` adapts our schemas (all properties required, `additionalProperties: false`); the extraction schema was already strict. Errors map to the same `AIProviderError` kinds (429 daily vs per-minute from `x-ratelimit-remaining-requests` and the body; 400 -> `bad_response`; 401/403/404 -> `not_configured`); retries only for 5xx/network, once.
- Selection (`createAIProvider`): `AI_PROVIDER` = `gemini` | `groq`; blank = Gemini if configured, else Groq if configured. A chosen but incomplete provider leaves AI off and never falls back to the other one.
- Automated tests use mocked network only (`tests/unit/groq-provider.test.ts`). Live checks, each exactly one request on the isolated `noteflow_test` database with Gemini off: one note extraction (valid, saved the expected todo) and one Ask AI question (HTTP 200, grounded answer, `used_notes` mapped to the correct source, history and source row saved). Reminder extraction and relative dates ("tomorrow") have not been tried live.

## Final release audit (9 Oct 2026)

- Original assignment found at `Downloads/AI Developer Intern - Assignment .md` (not in the repo). **Core item 1 says: "Do not build your own email and password login."** The app ships email/password sign-up, sign-in, verification, recovery and Google linking, added by owner change request. **Resolved in Phase 1:** they are disabled by default (`ENABLE_PASSWORD_AUTH=false`); nothing was removed, and password-only accounts cannot sign in while it is off.
- The assignment does **not** require manual creation of todos or reminders (todos/reminders come from notes; the user ticks, edits, deletes).
- `npm run check` passed: 789 backend tests, 238 frontend tests, typecheck, lint, Prettier, both builds. `npm audit`: 0 vulnerabilities (production and dev).
- Secret scan: none of the current `.env` secret values appears in any of the 13 commits or in tracked files; `.env` was never committed.
- Security review found no P0/P1. Open P2: no `trust proxy` setting (per-IP limits would be shared behind a proxy), limits are per process. Fixed P3: missing favicon (a 404 on every page load), two stale comments in `app.ts`. Docs: README now has deployment notes and known limitations; Architecture.md and Agents.md mention Groq.
- The dev backend (port 3001, `noteflow` database) was started before `AI_PROVIDER=groq` was saved. `tsx watch` restarted it at 22:23 IST after a source edit, so it now loads the Groq configuration (confirmed by selecting the provider from the real `.env`; no model call). Saving a real note now sends it to Groq.

## Deployment configuration (not yet deployed)

- `render.yaml` (API + PostgreSQL, single instance, migrations run in the start command, health check `/api/health`) and `vercel.json` (static frontend, `/api` rewrite to the Render host, SPA fallback). The Render host in `vercel.json` is a placeholder until the API exists. Verified locally only: production start, migrations, health, Secure cookie, origin check, password routes 404. A real Google round trip and live hosting are unverified.
