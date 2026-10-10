# PRD — AI Notes, Todos & Reminders

## 1. What to Build

Build the AI Notes, Todos and Reminders application described by the assignment.

### Assignment Priority

The implementation order is:

1. **Core / Required** — must be completed.
2. **Should Have** — complete after the core works.
3. **Bonus / Optional** — only after the core and Should Have work are stable.

Do not treat implementation preferences, visual decisions, or engineering choices as additional assignment requirements.

Build an AI-powered personal productivity application where users can:

- Sign in securely with Google OAuth.
- Create, view, edit, and delete notes.
- Have AI analyze each saved note and extract actionable intent.
- Automatically create todos and reminders from that intent.
- View and manage todos.
- View reminders and receive in-app alerts when they become due.
- Ask natural-language questions about their saved notes.
- Receive grounded AI answers with the source notes used to answer.
- View Ask AI question/answer history.

The frontend must be a real React application.

The product should be coherent and usable. Visual polish is an implementation goal, not a substitute for assignment functionality.

### Example

Input note:

> buy milk tomorrow

Expected derived action:

- Todo: Buy milk
- Due: tomorrow, resolved in the user's timezone

Input note:

> remind John to send the invoice by Friday 5pm

Expected derived action:

- Reminder: Send the invoice
- Person: John
- Due: Friday 5:00 PM

Informational note:

> Project meeting went well today.

Expected result:

- Note is saved.
- No todo or reminder is created.

---

## 2. Problem

People capture intentions in unstructured notes, but those intentions often disappear inside text.

A note such as:

> call Rahul tomorrow about the deployment

contains an actionable task and a time reference, but a conventional notes application stores it as passive text.

Users should not have to manually convert every thought into a separate todo or reminder.

The product solves this by turning natural-language notes into structured, manageable actions while preserving the original note as the source of truth.

A second problem is information retrieval.

Once many notes exist, users may remember that they wrote something without remembering exactly where. Ask AI allows them to query their own notes using natural language instead of manually searching every note.

---

## 3. Goal

### Primary Goal

Convert unstructured personal notes into useful, trustworthy actions without forcing the user to structure their thoughts manually.

### Product Goals

1. Make note capture frictionless.
2. Correctly identify actionable intent.
3. Create useful todos and reminders automatically.
4. Never invent actions or times without sufficient evidence.
5. Keep all user data isolated and private.
6. Make AI output structured and validated.
7. Handle relative dates using the user's timezone.
8. Prevent duplicate actions when notes are edited and re-saved.
9. Make Ask AI grounded in the user's actual notes.
10. Make every AI-derived action traceable back to its source note.
11. Provide clear failure states instead of silently failing.
12. Deliver a polished and credible engineering implementation.

---

## 4. Target Users

### Primary User

The assignment describes a personal notes/productivity use case; it does not require team or multi-user collaboration features beyond isolating each signed-in user's own data.


Individual users who capture:

- tasks
- reminders
- ideas
- meeting notes
- personal notes
- follow-ups
- shopping items
- deadlines

and want the application to automatically turn actionable information into structured work.

### Example User Behaviors

- Writes quick notes from meetings.
- Records things they need to buy.
- Captures follow-up actions.
- Writes reminders in natural language.
- Remembers information but not which note contains it.
- Wants AI assistance without giving up control of the resulting tasks.

### Non-Goals

This is not initially intended to be:

- a team project-management platform
- a full calendar replacement
- a general-purpose chatbot
- an email notification platform
- a social application

---

# 5. Features

## P0 — Core

### Authentication

> Assignment compliance: only Google OAuth is active by default. The email/password items below are implemented but **disabled** unless `ENABLE_PASSWORD_AUTH=true` (the assignment forbids a custom email/password login). Password-only accounts cannot sign in while it is off; their records are preserved.

- Google OAuth.
- Email/password registration and sign-in (added by change request; Argon2id, rate limited). A sign-up is only a pending record until the owner opens an emailed one-time link and re-enters the password they chose; it never reserves the address.
- Password reset by emailed one-time link (ends all sessions). Both need an email provider (Resend or SMTP, e.g. Gmail with an App Password); without one the features are switched off, not faked.
- Google and password accounts are never merged automatically on email alone. A signed-in password user can connect Google from Settings after re-entering their password.
- Logout.
- Protected backend APIs.
- Server-side authorization.
- Strict per-user data isolation.

### Notes

- Create.
- Read/list.
- Update.
- Delete.
- Title and content.
- Persistent database storage.
- Ownership tied to authenticated user.

### AI Intent Extraction

On note save, AI determines:

- todos
- reminders
- nothing actionable

Todos can contain due date/time.

Reminders can contain:

- content
- person
- due date/time

AI must return structured data.

Backend validates the response before persistence.

### Todos

- List.
- Open/done state.
- Toggle completion.
- Edit.
- Delete.
- Optional due date/time.
- Source-note relationship.
- AI-created indicator.

### Reminders

- List.
- Date/time display.
- Person when available.
- Source-note relationship.
- AI-created indicator.
- In-app due alert.

Email and push notifications are not required.

### Ask AI

- Natural-language question input.
- Backend retrieves relevant notes.
- Only the authenticated user's notes may be used.
- AI generates grounded answer.
- Source notes displayed.
- Question/answer history persisted.
- History visible in UI.

### Error Handling

Handle clearly:

- AI failure
- empty note
- missing AI API key/configuration
- failed login
- malformed AI output
- unauthorized requests
- database/API failures

---

## P1 — Should Have

### Timezone Awareness

Correctly resolve:

- tomorrow
- next Friday
- in two hours

using the user's timezone.

### Duplicate Prevention

Editing and re-saving a note must not blindly create duplicate todos/reminders.

Derived AI state should be reconciled.

### AI Labels

Clearly indicate records created by AI.

AI-created records remain user-editable and user-deletable.

---

## P2 — Bonus

Only implement after P0 and P1 are stable.

- Unclear reminder state such as `needs a time`.
- Recurring reminders.
- Notify another user.
- Smarter Ask AI relevance ranking.
- Docker setup.

Bonus features must never destabilize core functionality.

---

# 6. Success Metrics

Success is measured primarily by correctness and reliability rather than feature count.

## Functional Success

- 100% of mandatory assignment requirements implemented.
- All critical acceptance tests pass.
- Notes survive refresh and restart.
- Todos and reminders persist correctly.
- Ask AI history persists correctly.

## AI Success

Target:

- High precision on clearly actionable notes.
- Zero fabricated due dates in deterministic test cases.
- Zero actionable records for clearly non-actionable notes.
- Structured output validation succeeds or fails safely.
- AI failures never corrupt stored notes.

## Security Success

Target:

- Zero known cross-user data-access paths.
- Protected endpoints reject unauthenticated requests.
- Resource ownership checked server-side.
- No secrets exposed to the client.

## Reliability Success

Target:

- No duplicate derived actions from repeated saves.
- Timezone test suite passes.
- Malformed AI responses do not crash the application.
- Dependency failures produce controlled errors.

## UX Success

Target:

- Every primary screen has loading, empty, success, and error states where relevant.
- Users can understand where an AI-created action came from.
- Source notes are visible for derived actions and Ask AI answers.
- Core workflows are usable on desktop and mobile.

## Engineering Success

Target:

- Clean type checking.
- Automated tests for critical paths.
- Reproducible setup.
- Clear environment-variable documentation.
- No debug or placeholder implementation in mandatory paths.
