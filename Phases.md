# Implementation Phases

The agent must work through these phases in order unless repository constraints require a documented deviation.

Assignment priority:

- P0 — Core / Required: complete first.
- P1 — Should Have: complete after P0.
- P2 — Bonus / Optional: only after P0 and P1 are stable.

Do not skip to visual polish or bonus work while required functionality is incomplete.

---

# Phase 0 — Repository Discovery

## Objective

Understand what already exists.

### Tasks

- Inspect repository.
- Identify frontend framework.
- Identify backend framework.
- Identify database.
- Identify auth implementation.
- Identify AI provider.
- Identify test framework.
- Inspect environment configuration.
- Inspect deployment configuration.
- Run existing tests/build/typecheck where possible.
- Record current state.

### Exit Criteria

- Architecture understood.
- Existing working features identified.
- No major unknown about project structure.

---

# Phase 1 — Foundation

## Objective

Establish reliable application foundations.

### Tasks

- Database connection.
- Schema/migrations.
- User model.
- Authentication foundation.
- Session handling.
- API error conventions.
- Request validation.
- Environment configuration.

### Exit Criteria

- Application starts.
- Database connects.
- Google OAuth works.
- Protected endpoint rejects signed-out users.
- Authenticated user identity is available server-side.

---

# Phase 2 — Notes

## Objective

Build the source-of-truth note system.

### Tasks

- Note model.
- Create.
- List/view.
- Edit.
- Delete.
- Ownership checks.
- Frontend note UI.
- Loading/error/empty states.
- Tests.

### Exit Criteria

- Notes persist.
- User can perform full CRUD.
- User A cannot access User B's notes.
- Refresh preserves data.

---

# Phase 3 — AI Intent Extraction

## Objective

Convert note content into validated structured intent.

### Tasks

- AI service abstraction.
- Extraction schema.
- Prompt.
- Structured output.
- Parser.
- Schema validation.
- Business validation.
- Error handling.
- Prompt-injection boundaries.
- Unit tests.

### Test Cases

At minimum:

- normal note
- todo
- reminder
- reminder with person
- reminder with date/time
- multiple actions
- malformed output
- no actionable content
- AI failure
- missing API key

### Exit Criteria

- AI response is never blindly persisted.
- Invalid output fails safely.
- Correct test cases pass.

---

# Phase 4 — Todos

## Objective

Persist and manage AI-created todos.

### Tasks

- Todo model.
- Source-note relationship.
- Create/update/delete.
- Completion state.
- Todo UI.
- AI-created label.
- Source note navigation.
- Tests.

### Exit Criteria

- Todos are real database records.
- User can manage them.
- Ownership is enforced.
- Source note is visible.
- AI-created state is visible.

---

# Phase 5 — Reminders

## Objective

Persist reminders and alert users when due.

### Tasks

- Reminder model.
- Date/time handling.
- Person field.
- Source note.
- Reminder UI.
- Due detection.
- In-app alert.
- Alert deduplication during a session.
- Tests.

### Exit Criteria

- Reminder data persists.
- Date/time displays correctly.
- Due reminder creates an in-app alert.
- User cannot access another user's reminders.

---

# Phase 6 — Ask AI

## Objective

Create grounded natural-language retrieval over notes.

### Tasks

- Ask endpoint.
- Candidate-note retrieval.
- Context construction.
- Prompt.
- Grounded answer contract.
- Source references.
- Source validation.
- History persistence.
- History UI.
- Tests.

### Exit Criteria

- User receives an answer based on their notes.
- Source notes are displayed.
- History persists.
- Cross-user note leakage is impossible.

---

# Phase 7 — Timezone Support

## Objective

Make natural-language time correct.

### Tasks

- Detect/store user timezone.
- Define canonical storage convention.
- Pass reference time and timezone to AI service.
- Validate generated timestamps.
- Display dates in user timezone.
- Add deterministic timezone tests.

### Exit Criteria

Correct handling of:

- tomorrow
- next Friday
- in two hours

---

# Phase 8 — Idempotency and Reconciliation

## Objective

Prevent duplicate derived actions.

### Tasks

- Define derived-action identity.
- Track source note.
- Compare new extraction with existing derived records.
- Preserve user edits where appropriate.
- Remove/update stale AI-derived records where product behavior requires.
- Add repeat-save tests.

### Exit Criteria

Repeated save does not produce duplicate actions.

Editing a note updates its derived state correctly.

---

# Phase 9 — UX and Design Refinement

## Objective

Make the product polished after functionality is stable.

### Tasks

- Apply `Design.md`.
- Consistent components.
- Responsive layout.
- Loading states.
- Empty states.
- Error states.
- Confirmation interactions.
- Accessibility.
- Micro-interactions where useful.

### Exit Criteria

Core flows are coherent and usable across target breakpoints.

---

# Phase 10 — Security and Reliability Audit

## Objective

Attack the application before submission.

### Verify

- unauthenticated APIs
- IDOR
- cross-user queries
- client-supplied user IDs
- malformed AI output
- prompt injection
- source-note spoofing
- missing API keys
- database failures
- AI timeouts
- invalid dates
- duplicate saves

### Exit Criteria

No known critical security or data-integrity issue.

---

# Phase 11 — Test and Build Gate

## Objective

Prove the project works.

### Run

- frontend tests
- backend tests
- integration tests
- typecheck
- lint
- production build

Fix failures rather than suppressing them.

### Exit Criteria

All critical checks pass.

---

# Phase 12 — Bonus Features

Only begin when all P0 and P1 work is stable.

Implement only if time and stability permit. The assignment lists these as optional bonus scope:

1. unclear reminder handling
2. recurring reminders
3. notify another user
4. smarter Ask AI retrieval
5. Docker

Do not treat Docker or any other bonus item as required for submission.

Do not sacrifice core reliability for bonus scope.

---

# Phase 13 — Submission Review

## Final Actions

- Read PRD.
- Read Architecture.
- Read Agents.
- Read Design.
- Run final test suite.
- Inspect Git diff.
- Check secrets.
- Check `.env.example`.
- Check README.
- Verify deployment if applicable.
- Execute the manual demo flow.
- Complete final acceptance checklist.

Final state must be:

`READY TO SUBMIT`
