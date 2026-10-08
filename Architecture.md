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

The exact framework can follow the existing repository. Do not rewrite an existing working stack without a technical reason.

---

# 2. Data Flow and Architecture

## Authentication Flow

```text
User
  │
  ▼
Google OAuth
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
Structured JSON
        │
        ▼
Schema validation
        │
        ▼
Business-rule validation
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
AI
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

---

# Data Model

## User

- id
- OAuth provider identifier
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
- extraction metadata
- created_at
- updated_at

## Reminder

- id
- user_id
- source_note_id
- content
- person
- due_at
- status/alert metadata
- created_by_ai
- extraction metadata
- created_at
- updated_at

## AskHistory

- id
- user_id
- question
- answer
- source note references
- created_at

Use foreign keys and indexes appropriate to the chosen database.

---

# 3. Folder and File Structure

The exact structure depends on the repository, but prefer clear separation of concerns.

Example:

```text
project/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── notes/
│   │   │   ├── todos/
│   │   │   ├── reminders/
│   │   │   ├── ask-ai/
│   │   │   └── auth/
│   │   ├── lib/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── styles/
│   └── tests/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   │   ├── ai/
│   │   │   ├── notes/
│   │   │   ├── todos/
│   │   │   ├── reminders/
│   │   │   └── ask/
│   │   ├── db/
│   │   ├── middleware/
│   │   └── core/
│   └── tests/
│
├── docs/
├── migrations/
├── .env.example
└── README.md
```

If the existing repository uses a monorepo or another convention, preserve the established structure when it is sound.

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

## Preferred Database

- PostgreSQL — preferred by the assignment.
- SQLite — acceptable alternative.

## Implementation Choices

The assignment does not prescribe:

- TypeScript
- JavaScript
- Next.js
- Express
- FastAPI
- Python
- Tailwind CSS
- a specific ORM
- a specific AI provider
- a specific hosting provider

These are implementation decisions and must be selected based on the existing repository and the simplest reliable architecture.

If an existing repository already has a sound frontend/backend stack, preserve it rather than replacing it without a technical reason.

## AI Integration

Keep AI provider-specific code behind a service/module boundary.

Prefer structured-output or JSON-schema support when the selected provider supports it, but do not treat any particular AI provider or SDK as an assignment requirement.

## Testing

Testing is an engineering quality requirement for this project, especially for critical paths, but the assignment does not prescribe a particular testing framework.

Use the repository's native testing ecosystem where one exists.

---

# 5. Scalability and Future Considerations

Do not over-engineer the assignment, but avoid architectural decisions that make obvious future growth painful.

## AI Provider Abstraction

Keep model calls behind a service interface.

Future:

- switch model provider
- compare models
- use fallback provider
- track model quality

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

For the assignment, synchronous processing is sufficient unless the existing architecture already requires another approach. Do not introduce queues or workers merely for scale that the assignment does not require.

## Search

Baseline retrieval can use PostgreSQL filtering/ranking.

Future:

- full-text search
- embeddings
- vector database
- hybrid retrieval
- relevance ranking

## Reminder Infrastructure

The assignment only requires in-app alerts.

Future production scale could use:

- scheduled workers
- queues
- notification service
- WebSockets
- push notifications

## Observability

Future production improvements:

- structured logs
- error tracking
- AI latency metrics
- extraction success rate
- token/cost tracking
- reminder delivery metrics

## Multi-Tenant Security

Every database query involving user-owned data should have an explicit ownership constraint.

Future PostgreSQL Row Level Security could provide an additional defense layer.

## Performance

Optimize only after measuring.

Potential improvements:

- database indexes
- pagination
- caching
- query optimization
- bounded AI context
- async processing
