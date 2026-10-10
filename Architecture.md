# Architecture

## 1. System Overview

The application is a multi-layer AI productivity system.

```text
┌─────────────────────────────────────────────┐
│                 React Frontend               │
│                                             │
│ Notes │ Todos │ Reminders │ Ask AI │ Auth  │
└──────────────────────┬──────────────────────┘
                       │ HTTPS / API
                       ▼
┌─────────────────────────────────────────────┐
│                  Backend API                 │
│                                             │
│ Auth │ Authorization │ Validation │ Domain │
└─────────────┬───────────────────┬───────────┘
              │                   │
              ▼                   ▼
┌─────────────────────┐   ┌───────────────────┐
│    PostgreSQL       │   │     AI Service    │
│                     │   │                   │
│ Users               │   │ Intent Extraction │
│ Notes               │   │ Ask AI            │
│ Todos               │   │ Structured Output │
│ Reminders           │   │ Validation        │
│ Ask History         │   │                   │
└─────────────────────┘   └───────────────────┘
```

The implementation uses the repository's selected stack:

- React + Vite + TypeScript frontend.
- Node.js + Express + TypeScript backend.
- PostgreSQL with Drizzle ORM.
- Google OAuth with server-managed sessions.
- Gemini API behind an AI provider abstraction.
- Zod for runtime validation.
- Vitest for automated testing.

Do not rewrite the working stack without a technical reason.

The Gemini API key is backend-only and must never be exposed to the browser.

---

# 2. Data Flow and Architecture

## Authentication Flow

```text
User
  │
  ▼
Google OAuth  (Email + password only when ENABLE_PASSWORD_AUTH=true; off by default)
  │
  ▼
Authenticated Session
  │
  ▼
Backend Auth Middleware
  │
  ▼
Authenticated User ID
```

The backend derives the user identity from the authenticated session.

Never trust a user ID supplied by the browser.

---

## Note Creation Flow

```text
User creates/edits note
        │
        ▼
Frontend validation
        │
        ▼
Authenticated API
        │
        ▼
Backend authorization
        │
        ▼
Save note
        │
        ▼
AI Intent Extraction
        │
        ▼
AIProvider
        │
        ▼
GeminiProvider
        │
        ▼
Gemini API
        │
        ▼
Structured JSON
        │
        ▼
Schema validation
        │
        ▼
Business-rule validation
        │
        ▼
Normalization
        │
        ▼
Reconcile derived todos/reminders
        │
        ▼
Database
        │
        ▼
Updated UI
```

AI output must never be written directly to the database.

The backend remains authoritative over validation, ownership, authorization, dates, and persistence.

---

## Ask AI Flow

```text
User question
      │
      ▼
Authenticated API
      │
      ▼
Verify user
      │
      ▼
Retrieve candidate notes owned by user
      │
      ▼
Filter/rank relevant context
      │
      ▼
AIProvider
      │
      ▼
GeminiProvider
      │
      ▼
Gemini API
      │
      ▼
Answer + source references
      │
      ▼
Backend validates sources
      │
      ▼
Persist question + answer
      │
      ▼
Frontend displays answer + source notes
```

The model cannot be trusted to invent valid source IDs.

The backend must verify every source against the retrieved context and authenticated user.

Retrieved note content is untrusted data and must not override the system's instructions.

---

# Data Model

## User

- id
- Google OAuth provider identifier
- email
- name
- timezone
- created_at
- updated_at

## Note

- id
- user_id
- title
- content
- created_at
- updated_at

## Todo

- id
- user_id
- source_note_id
- title
- due_at
- completed
- created_by_ai
- AI extraction metadata
- created_at
- updated_at

## Reminder

- id
- user_id
- source_note_id
- content
- person
- due_at (for a repeating reminder: always its NEXT occurrence)
- recurrence_days (ISO weekdays 1-7, NULL = one-off) and recurrence_time ("HH:mm" wall clock in the owner's timezone, NULL = start of day)
- status/alert metadata
- created_by_ai
- AI extraction metadata (ai_fingerprint, ai_text = the model's original wording, user_modified)
- created_at
- updated_at

## ReminderShare

A reminder explicitly shared by its owner with one other user (`reminder_shares`):

- id
- reminder_id and owner_id (a composite foreign key to `reminders(id, user_id)`: the sharer must own it)
- recipient_id (a real user resolved server-side from a verified account email; never a display name)
- created_at
- acknowledged_at (the recipient's own acknowledgement; independent of the owner's)

Unique per (reminder, recipient); a user cannot share with themselves; deleting the reminder or either
account deletes the share. The recipient reads it only through `GET /api/shared-reminders`, which returns
the reminder's text, time and repeat rule and the sender's name, never the source note.

## AskHistory

- id
- user_id
- question
- answer
- source note references
- created_at

Use foreign keys and indexes appropriate to PostgreSQL.

Every user-owned record must be queried with an explicit ownership constraint.

---

# 3. Folder and File Structure

The actual repository is a TypeScript monorepo with separate frontend and backend workspaces.

```text
NoteFlow/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── notes/
│   │   │   ├── todos/
│   │   │   ├── reminders/
│   │   │   └── ask-ai/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── styles/
│   │   └── types/
│   └── tests/
│
├── backend/
│   ├── src/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── db/
│   │   ├── middleware/
│   │   ├── modules/
│   │   │   ├── ask/
│   │   │   ├── notes/
│   │   │   ├── reminders/
│   │   │   ├── todos/
│   │   │   └── users/
│   │   ├── ai/
│   │   │   ├── provider/
│   │   │   ├── extraction/
│   │   │   └── ask/
│   │   ├── reconcile/
│   │   ├── lib/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── drizzle/
│   └── tests/
│
├── docs/
├── .env.example
├── docker-compose.dev.yml
├── package.json
└── README.md
```

The structure separates provider-specific AI code from application/domain logic.

---

# 4. Tech Stack

## Assignment Requirements

The assignment explicitly requires:

- A real React frontend.
- Google OAuth authentication.
- A database for notes and user-owned data.
- An AI model integration.
- Structured JSON output from the AI.
- Backend validation of AI output.
- Authenticated APIs that reject unauthenticated requests.
- Per-user isolation of notes, todos, and reminders.
- In-app reminder alerts.
- Ask AI over the user's saved notes.

The assignment explicitly prefers PostgreSQL and accepts SQLite as an alternative.

## Selected Implementation

### Frontend

- React
- Vite
- TypeScript
- CSS/design-system utilities already established in the repository

### Backend

- Node.js
- Express
- TypeScript

### Database

- PostgreSQL
- Drizzle ORM
- SQL migrations managed in `backend/drizzle/`

### Authentication

- Google OAuth
- Server-managed session cookies
- Signed OAuth state/PKCE/nonce protection
- Backend authorization middleware

### Validation

- Zod
- Server-side request validation
- Server-side AI response validation

### AI

Gemini is the selected AI provider for the current implementation.

The provider boundary is:

```text
Application / Domain Logic
          │
          ▼
      AIProvider
          │
          ▼
   GeminiProvider
          │
          ▼
      Gemini API
```

The assignment does not require Gemini specifically. The provider abstraction exists so another provider can be introduced without changing the domain logic.

`GroqProvider` (OpenAI-compatible chat completions, strict JSON-schema output, default model `openai/gpt-oss-120b`) is a second implementation of the same interface. `AI_PROVIDER` (`gemini` or `groq`) selects one; an explicit choice that is incomplete turns AI off and never falls back to the other provider. Both providers' output goes through the same parse, schema and business validation.

### Testing

- Vitest
- Backend integration tests against PostgreSQL
- Frontend component tests
- TypeScript typechecking
- Linting
- Production build verification

---

## AI Integration

AI provider-specific code must remain behind the provider boundary.

Current environment configuration:

```text
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
```

Rules:

- `GEMINI_API_KEY` is backend-only.
- Never expose the key through frontend code.
- Never place the key in `.env.example`.
- Never commit the real key.
- Never log the key.
- Read the model name from environment configuration.
- Do not call the Gemini SDK directly from business/domain modules.
- Validate every model response before persistence.
- Treat note content and retrieved note content as untrusted input.

The common AI pipeline is:

```text
Provider call
     ↓
Parse
     ↓
Schema validation
     ↓
Business validation
     ↓
Normalization
     ↓
Reconciliation
     ↓
Persistence
```

Malformed or unexpected AI output must fail safely and must not corrupt application state.

---

## Date and Time

The system must distinguish:

- user's IANA timezone
- server/runtime timezone
- UTC storage
- displayed local time

Natural-language expressions such as:

- tomorrow
- next Friday
- in two hours

must be interpreted using the user's timezone.

Canonical timestamps are stored consistently in PostgreSQL.

### How it is implemented

- The account timezone (`users.timezone`, an IANA id) is taken from the browser once, at the first
  sign-in (`/api/auth/google?tz=`), validated, and never overwritten by later sign-ins. An invalid or
  missing value stores `UTC`. `PATCH /api/me` can change it (there is no picker in the UI).
- Everything is stored as UTC instants (`timestamptz`). The browser never sends instants: it sends the
  user's local `{ date, time? }` and the server converts it with Luxon in the account timezone
  (`backend/src/lib/dueInput.ts`, shared by todos and reminders). AI-extracted dates are resolved the same
  way (`ai/extraction/dates.ts`): the model returns local wall-clock text, never an instant.
- Date only: no time is invented (`due_has_time = false`). A todo is due at the END of that local day, a
  reminder alerts at the START of it. No date: `due_at` is NULL (a reminder with none never alerts).
- Daylight saving follows Luxon: a local time that does not exist (spring-forward gap) moves forward by the
  gap (02:30 becomes 03:30); a local time that happens twice (fall back) takes its FIRST occurrence.
  "In two hours" is real elapsed time from the server clock.
- Display (`frontend/src/lib/time.ts`) converts instants back with `Intl.DateTimeFormat` in the account
  timezone for due dates, note timestamps and Ask AI history. Overdue/due-now compare instants.

---

## Authentication and Authorization

Google OAuth is the only user authentication method required by the assignment.

The backend:

- derives identity from the authenticated session
- rejects unauthenticated protected API requests
- applies ownership checks to user-owned resources
- never accepts a browser-supplied `user_id` as the authority

OAuth credentials and session secrets remain server-side.

---

# 5. Scalability and Future Considerations

Do not over-engineer the assignment, but avoid architectural decisions that make obvious future growth painful.

## AI Provider Abstraction

Keep model calls behind a service interface.

Current:

- Gemini provider

Future:

- switch model provider
- compare models
- use fallback provider
- track model quality
- evaluate extraction accuracy

The provider boundary should prevent vendor-specific SDK behavior from leaking into domain logic.

---

## Async AI Processing

For larger scale, note analysis can move to a job queue:

```text
Save Note
   │
   ▼
Database
   │
   ▼
Job Queue
   │
   ▼
AI Worker
   │
   ▼
Derived Actions
```

For the assignment, synchronous processing is sufficient. Do not introduce queues or workers merely for scale that the assignment does not require.

---

## Search

The current design uses PostgreSQL-based retrieval/filtering for Ask AI.

Future:

- full-text search improvements
- embeddings
- vector database
- hybrid retrieval
- relevance ranking

The optional smarter Ask AI ranking feature should only be added after the core retrieval flow is stable.

---

## Reminder Infrastructure

The assignment only requires in-app alerts.

Future production scale could use:

- scheduled workers
- queues
- notification service
- WebSockets
- push notifications

Email and push notifications are not required by the assignment.

---

## Observability

Future production improvements:

- structured logs
- error tracking
- AI latency metrics
- extraction success rate
- token/cost tracking
- reminder delivery metrics

Secrets and sensitive note contents must not be logged unnecessarily.

---

## Multi-Tenant Security

Every database query involving user-owned data should have an explicit ownership constraint.

The current schema also uses ownership-aware relationships to prevent cross-user references.

Future PostgreSQL Row Level Security could provide an additional defense layer.

---

## Performance

Optimize only after measuring.

Potential improvements:

- database indexes
- pagination
- caching
- query optimization
- bounded AI context
- asynchronous processing
- background reminder scheduling

Do not introduce infrastructure solely because it might be useful at larger scale.
