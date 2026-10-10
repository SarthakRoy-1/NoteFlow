import { Link } from 'react-router-dom';
import { describeRecurrence } from '../../lib/recurrence';
import { formatDue } from '../../lib/time';
import { useMe } from '../auth/useAuth';
import { PendingReminders } from '../reminders/PendingReminders';
import { useReminders } from '../reminders/useReminders';
import { useTodos } from '../todos/useTodos';

/** The todos and reminders the AI created from this note, so the note shows what became of it. */
export function DerivedItems({ noteId }: { noteId: string }) {
  const timezone = useMe().data?.timezone ?? 'UTC';
  const todos = (useTodos().data ?? []).filter((t) => t.sourceNote.id === noteId);
  const reminders = (useReminders().data ?? []).filter((r) => r.sourceNote.id === noteId);
  const pending = <PendingReminders noteId={noteId} timezone={timezone} />;
  if (todos.length === 0 && reminders.length === 0) return pending;

  return (
    <>
      {pending}
      <section className="derived" aria-label="Created from this note">
        <h2>Created from this note</h2>
        <ul className="derived-list">
          {todos.map((t) => (
            <li key={t.id}>
              <Link to="/todos">Todo</Link>
              <span className={t.completed ? 'derived-title todo-done' : 'derived-title'}>
                {t.title}
              </span>
              {t.dueAt && (
                <span className="muted">Due {formatDue(t.dueAt, t.dueHasTime, timezone)}</span>
              )}
            </li>
          ))}
          {reminders.map((r) => (
            <li key={r.id}>
              <Link to="/reminders">Reminder</Link>
              <span className="derived-title">{r.text}</span>
              {r.person && <span className="muted">For {r.person}</span>}
              <span className="muted">
                {r.dueAt ? `Due ${formatDue(r.dueAt, r.dueHasTime, timezone)}` : 'No time set'}
              </span>
              {r.recurrence && <span className="muted">{describeRecurrence(r.recurrence)}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
