import { Link } from 'react-router-dom';
import { formatDue } from '../../lib/time';
import { useMe } from '../auth/useAuth';
import { errorMessage } from '../notes/useNotes';
import type { Reminder } from './remindersApi';
import { useDueReminders, useUpdateReminder } from './useReminders';

const MAX_SHOWN = 3;

function AlertRow({ reminder, timezone }: { reminder: Reminder; timezone: string }) {
  const acknowledge = useUpdateReminder(reminder.id);
  return (
    <li className="due-alert" role="alert">
      <div className="due-alert-body">
        <strong className="due-alert-text">{reminder.text}</strong>
        <div className="due-alert-meta">
          {reminder.person && <span>For {reminder.person}</span>}
          {reminder.dueAt && (
            <span>Due {formatDue(reminder.dueAt, reminder.dueHasTime, timezone)}</span>
          )}
          <Link to={`/notes/${reminder.sourceNote.id}`}>
            From note: {reminder.sourceNote.title}
          </Link>
        </div>
        {acknowledge.isError && (
          <span className="field-error">{errorMessage(acknowledge.error)}</span>
        )}
      </div>
      <button
        type="button"
        className="button"
        disabled={acknowledge.isPending}
        onClick={() => acknowledge.mutate({ acknowledged: true })}
        aria-label={`Acknowledge: ${reminder.text}`}
      >
        Got it
      </button>
    </li>
  );
}

/**
 * In-app alert banner, shown on every page while any reminder is due and not yet acknowledged.
 * It stays until the user acknowledges it, so a refresh or a second tab shows the same alerts and
 * nothing re-pops repeatedly. Errors fetching alerts are silent: the Reminders page still works.
 */
export function DueAlerts() {
  const { data: me } = useMe();
  const { data } = useDueReminders();
  const due = data?.reminders ?? [];
  if (due.length === 0) return null;

  const timezone = me?.timezone ?? 'UTC';
  const hidden = due.length - MAX_SHOWN;

  return (
    <section className="due-alerts" aria-label="Reminder alerts">
      <h2 className="due-alerts-title">
        {due.length === 1 ? '1 reminder is due' : `${due.length} reminders are due`}
      </h2>
      <ul className="due-alert-list">
        {due.slice(0, MAX_SHOWN).map((r) => (
          <AlertRow key={r.id} reminder={r} timezone={timezone} />
        ))}
      </ul>
      {hidden > 0 && (
        <p className="due-alerts-more">
          and {hidden} more · <Link to="/reminders">View all reminders</Link>
        </p>
      )}
    </section>
  );
}

/** Number of reminders currently due, for the navigation badge. */
export function useDueCount(): number {
  return useDueReminders().data?.reminders.length ?? 0;
}
