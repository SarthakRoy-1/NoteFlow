import { describeRecurrence } from '../../lib/recurrence';
import { formatDue } from '../../lib/time';
import { errorMessage } from '../notes/useNotes';
import type { SharedReminder } from './sharedApi';
import { useAcknowledgeShared, useRemoveShared, useSharedReminders } from './useShared';

function SharedRow({ item, timezone }: { item: SharedReminder; timezone: string }) {
  const acknowledge = useAcknowledgeShared(item.id);
  const remove = useRemoveShared(item.id);
  const failed = acknowledge.isError ? acknowledge.error : remove.isError ? remove.error : null;
  const className = ['todo-item', 'reminder-item', item.due && 'reminder-due']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={className}>
      <div className="todo-body">
        <span className="todo-title">{item.text}</span>
        <div className="todo-meta">
          {item.dueAt ? (
            <span className={item.due ? 'todo-due todo-overdue' : 'todo-due'}>
              {item.recurrence ? 'Next ' : 'Due '}
              {formatDue(item.dueAt, item.dueHasTime, timezone)}
              {item.due && ' · Due now'}
            </span>
          ) : (
            <span className="todo-due">No time set</span>
          )}
          {item.recurrence && (
            <span className="badge badge-person">{describeRecurrence(item.recurrence)}</span>
          )}
          <span className="badge badge-person">From {item.from.name}</span>
          {item.isNew && <span className="badge">New</span>}
        </div>
      </div>
      {failed && (
        <p role="alert" className="alert alert-error">
          {errorMessage(failed)}
        </p>
      )}
      <div className="actions reminder-actions">
        {(item.due || item.isNew) && (
          <button
            type="button"
            className={item.due ? 'button button-primary' : 'button'}
            disabled={acknowledge.isPending}
            onClick={() => acknowledge.mutate()}
            aria-label={`Acknowledge shared reminder: ${item.text}`}
          >
            Got it
          </button>
        )}
        <button
          type="button"
          className="button button-danger-outline"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          aria-label={`Remove shared reminder: ${item.text}`}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/** Reminders other NoteFlow users shared with me. Hidden while there are none. */
export function SharedWithYou({ timezone }: { timezone: string }) {
  const items = useSharedReminders().data?.shared ?? [];
  if (items.length === 0) return null;
  return (
    <section className="reminder-section" aria-label="Shared with you">
      <h2>
        Shared with you <span className="muted">({items.length})</span>
      </h2>
      <ul className="todo-list">
        {items.map((item) => (
          <SharedRow key={item.id} item={item} timezone={timezone} />
        ))}
      </ul>
    </section>
  );
}
