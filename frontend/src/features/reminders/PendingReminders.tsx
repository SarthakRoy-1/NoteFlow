import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { describeRecurrence } from '../../lib/recurrence';
import { errorMessage } from '../notes/useNotes';
import type { ReminderDraft } from './draftsApi';
import { useCompleteDraft, useDismissDraft, useReminderDrafts } from './useReminderDrafts';

function DraftItem({ draft, timezone }: { draft: ReminderDraft; timezone: string }) {
  const complete = useCompleteDraft(draft.id);
  const dismiss = useDismissDraft(draft.id);
  const [date, setDate] = useState(draft.suggestedDate ?? '');
  const [time, setTime] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const dateId = useId();
  const timeId = useId();
  const repeats = draft.recurrence !== null;
  const busy = complete.isPending || dismiss.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Cheap checks for convenience only: the server is the authority and re-checks everything.
    if (!repeats && !date) return setProblem('Choose a date for this reminder.');
    if (!time) return setProblem('Choose a time for this reminder.');
    setProblem(null);
    complete.mutate({ ...(repeats ? {} : { date }), time });
  };

  const shown = problem ?? (complete.isError ? errorMessage(complete.error) : null);

  return (
    <li className="draft-item">
      <div className="draft-head">
        <span className="draft-text">{draft.text}</span>
        {draft.person && <span className="muted">For {draft.person}</span>}
        {draft.recurrence && (
          <span className="muted">
            {describeRecurrence({ days: draft.recurrence.days, time: null })}
          </span>
        )}
        <Link className="muted" to={`/notes/${draft.sourceNote.id}`}>
          From note: {draft.sourceNote.title}
        </Link>
      </div>
      <form className="draft-form" onSubmit={submit} noValidate>
        {!repeats && (
          <div className="field">
            <label htmlFor={dateId}>Date</label>
            <input
              id={dateId}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
              required
            />
          </div>
        )}
        <div className="field">
          <label htmlFor={timeId}>Time ({timezone})</label>
          <input
            id={timeId}
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {complete.isPending ? 'Saving…' : 'Save reminder'}
          </button>
          <button type="button" className="button" onClick={() => dismiss.mutate()} disabled={busy}>
            {dismiss.isPending ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      </form>
      {shown && (
        <p role="alert" className="alert alert-error">
          {shown}
        </p>
      )}
      {dismiss.isError && (
        <p role="alert" className="alert alert-error">
          {errorMessage(dismiss.error)}
        </p>
      )}
    </li>
  );
}

/**
 * Reminders the AI found that still need a date and a time. `noteId` limits the list to one note.
 * Renders nothing when there are none, so it can sit on any page.
 */
export function PendingReminders({ noteId, timezone }: { noteId?: string; timezone: string }) {
  const drafts = (useReminderDrafts().data ?? []).filter(
    (d) => noteId === undefined || d.sourceNote.id === noteId,
  );
  if (drafts.length === 0) return null;
  return (
    <section className="reminder-section pending-reminders" aria-label="Needs a date and time">
      <h2>
        Needs a date and time <span className="muted">({drafts.length})</span>
      </h2>
      <p className="muted">
        The AI found {drafts.length === 1 ? 'a reminder' : 'reminders'} in your notes but not a full
        date and time. Nothing is guessed: add them to turn each one into a reminder.
      </p>
      <ul className="todo-list">
        {drafts.map((d) => (
          <DraftItem key={d.id} draft={d} timezone={timezone} />
        ))}
      </ul>
    </section>
  );
}
