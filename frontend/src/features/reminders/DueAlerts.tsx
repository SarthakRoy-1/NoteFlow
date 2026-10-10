import { Link } from 'react-router-dom';
import { formatDue } from '../../lib/time';
import { useMe } from '../auth/useAuth';
import { errorMessage } from '../notes/useNotes';
import type { SharedReminder } from '../shares/sharedApi';
import { useAcknowledgeShared, useSharedReminders } from '../shares/useShared';
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

/** A reminder another user shared with me that has come due. */
function SharedAlertRow({ item, timezone }: { item: SharedReminder; timezone: string }) {
  const acknowledge = useAcknowledgeShared(item.id);
  const when = item.occurrenceAt ?? item.dueAt;
  return (
    <li className="due-alert" role="alert">
      <div className="due-alert-body">
        <strong className="due-alert-text">{item.text}</strong>
        <div className="due-alert-meta">
          <span>Shared by {item.from.name}</span>
          {when && <span>Due {formatDue(when, item.dueHasTime, timezone)}</span>}
        </div>
        {acknowledge.isError && (
          <span className="field-error">{errorMessage(acknowledge.error)}</span>
        )}
      </div>
      <button
        type="button"
        className="button"
        disabled={acknowledge.isPending}
        onClick={() => acknowledge.mutate()}
        aria-label={`Acknowledge shared reminder: ${item.text}`}
      >
        Got it
      </button>
    </li>
  );
}

/**
 * In-app alert banner, shown on every page while any reminder (mine, or one shared with me) is due
 * and not yet acknowledged. It stays until acknowledged, so a refresh or a second tab shows the same
 * alerts and nothing re-pops repeatedly. Errors fetching alerts are silent: the Reminders page
 * still works.
 */
export function DueAlerts() {
  const { data: me } = useMe();
  const { data } = useDueReminders();
  const { data: sharedData } = useSharedReminders();
  const own = data?.reminders ?? [];
  const shared = (sharedData?.shared ?? []).filter((s) => s.due);
  const total = own.length + shared.length;
  if (total === 0) return null;

  const timezone = me?.timezone ?? 'UTC';
  const shownOwn = own.slice(0, MAX_SHOWN);
  const shownShared = shared.slice(0, Math.max(0, MAX_SHOWN - shownOwn.length));
  const hidden = total - shownOwn.length - shownShared.length;

  return (
    <section className="due-alerts" aria-label="Reminder alerts">
      <h2 className="due-alerts-title">
        {total === 1 ? '1 reminder is due' : `${total} reminders are due`}
      </h2>
      <ul className="due-alert-list">
        {shownOwn.map((r) => (
          <AlertRow key={r.id} reminder={r} timezone={timezone} />
        ))}
        {shownShared.map((s) => (
          <SharedAlertRow key={s.id} item={s} timezone={timezone} />
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

/** Number of reminders currently due (mine and shared with me), for the navigation badge. */
export function useDueCount(): number {
  const own = useDueReminders().data?.reminders.length ?? 0;
  const shared = (useSharedReminders().data?.shared ?? []).filter((s) => s.due).length;
  return own + shared;
}
