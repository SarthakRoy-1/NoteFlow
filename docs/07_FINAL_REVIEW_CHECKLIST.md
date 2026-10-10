# Final Review Checklist

Referenced by `Agents.md`. Derived from `PRD.md` §5–6 and the assignment requirements. Tick an item
only after verifying it in the running app or with an automated test.

## P0 — Core

### Auth & isolation

- [ ] Google OAuth sign-in works; custom email/password auth is disabled by default (`ENABLE_PASSWORD_AUTH=false`) and its routes return 404
- [ ] (Only if deliberately re-enabled) password reset and Google linking require a verified email and never merge accounts by email alone
- [ ] Failed/denied login shows a clear message
- [ ] Logout ends the session server-side
- [ ] Every `/api` route except `/auth/*` and `/health` returns 401 when signed out
- [ ] User A cannot read, edit or delete User B's notes, todos, reminders or Ask history (404)
- [ ] No request body or query param can set `user_id`

### Notes

- [ ] Create, view, edit, delete; title + content persisted in PostgreSQL
- [ ] Empty note rejected with a clear message
- [ ] Data survives refresh and server restart

### AI extraction

- [ ] Saving a note triggers extraction; output is structured JSON
- [ ] Todo / reminder / nothing-actionable all behave correctly
- [ ] Explicit "remind …" produces a reminder only, not also a todo
- [ ] Output is parsed → schema-validated → business-validated → normalised before persistence
- [ ] Malformed output, timeout, provider error, missing API key: note still saved, clear error, no crash
- [ ] Prompt-injection text in a note is treated as data

### Todos / Reminders

- [ ] Todos: open/done toggle, edit, delete, due date, link to source note, AI label
- [ ] Reminders: date/time shown, optional person, source note, AI label
- [ ] Reminder with no time shows "No time set" and never alerts
- [ ] Due reminder produces an in-app alert; acknowledged alerts do not return after refresh

### Ask AI

- [ ] Answers use only the signed-in user's notes
- [ ] Source notes shown; invented or foreign source IDs are dropped
- [ ] Question, answer and sources persisted and shown as history

## P1 — Should have

- [ ] "tomorrow", "next Friday", "in two hours" resolve in the user's IANA timezone (tested incl. DST)
- [ ] Date-only due dates stay date-only (no fabricated time)
- [ ] Re-saving an unchanged note creates no duplicates
- [ ] Editing a note reconciles derived items; user-edited and completed items are never destroyed
- [ ] User-deleted AI items do not reappear
- [ ] AI-created items are labelled and remain editable/deletable

## Engineering

- [ ] `npm run check` passes (typecheck, lint, format, tests, build)
- [ ] No secrets in git history; `.env` ignored; `.env.example` has names only
- [ ] README setup steps work from a clean clone
- [ ] Loading, empty, error states on every primary screen; usable on mobile
- [ ] `Memory.md` reflects the real state

## Bonus (only if core is stable)

- [ ] needs-a-time reminder state · [ ] recurring reminders · [ ] notify another user ·
      [ ] smarter Ask AI ranking · [ ] Docker
