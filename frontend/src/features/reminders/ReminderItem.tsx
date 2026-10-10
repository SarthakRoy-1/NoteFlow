import { useState } from 'react';
import { Link } from 'react-router-dom';
import { describeRecurrence } from '../../lib/recurrence';
import { formatDue, isPast } from '../../lib/time';
import { errorMessage } from '../notes/useNotes';
import { ReminderEditForm } from './ReminderEditForm';
import type { Reminder } from './remindersApi';
import { ShareReminder } from './ShareReminder';
import { useDeleteReminder, useUpdateReminder } from './useReminders';

/** A pending reminder whose time has arrived. Mirrors the server rule that drives alerts. */
export const isReminderDue = (r: Reminder, now: Date = new Date()) =>
  r.status === 'pending' && r.dueAt !== null && isPast(r.dueAt, now);

export function ReminderItem({ reminder, timezone }: { reminder: Reminder; timezone: string }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const update = useUpdateReminder(reminder.id);
  const remove = useDeleteReminder(reminder.id);

  const handled = reminder.status !== 'pending';
  const due = isReminderDue(reminder);
  const rowError = update.isError && !editing ? errorMessage(update.error) : null;

  if (editing) {
    return (
      <li className="todo-item todo-item-editing">
        <ReminderEditForm
          reminder={reminder}
          timezone={timezone}
          pending={update.isPending}
          error={update.isError ? errorMessage(update.error) : null}
          onSave={(changes) => update.mutate(changes, { onSuccess: () => setEditing(false) })}
          onCancel={() => {
            update.reset();
            setEditing(false);
          }}
        />
      </li>
    );
  }

  const className = ['todo-item', 'reminder-item', handled && 'todo-done', due && 'reminder-due']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={className}>
      <div className="todo-body">
        <span className="todo-title">{reminder.text}</span>
        <div className="todo-meta">
          {reminder.dueAt ? (
            <span className={due ? 'todo-due todo-overdue' : 'todo-due'}>
              Due {formatDue(reminder.dueAt, reminder.dueHasTime, timezone)}
              {due && ' · Due now'}
            </span>
          ) : (
            <span className="todo-due">No time set</span>
          )}
          {reminder.recurrence && (
            <span className="badge badge-person">{describeRecurrence(reminder.recurrence)}</span>
          )}
          {reminder.person && <span className="badge badge-person">For {reminder.person}</span>}
          {reminder.sharedWith.length > 0 && (
            <span className="badge badge-person">Shared with {reminder.sharedWith.length}</span>
          )}
          {reminder.createdByAi && <span className="badge">AI-created</span>}
          {handled && <span className="badge badge-done">Acknowledged</span>}
          <Link className="todo-source" to={`/notes/${reminder.sourceNote.id}`}>
            From note: {reminder.sourceNote.title}
          </Link>
        </div>
      </div>

      {rowError && (
        <p role="alert" className="alert alert-error">
          {rowError}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="alert alert-error">
          {errorMessage(remove.error)}
        </p>
      )}

      {sharing && <ShareReminder reminder={reminder} onClose={() => setSharing(false)} />}

      {confirmingDelete ? (
        <div className="confirm" role="group" aria-label={`Confirm delete: ${reminder.text}`}>
          <p>Delete this reminder? The note it came from is not affected.</p>
          <div className="actions">
            <button
              type="button"
              className="button button-danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, { onSettled: () => setConfirmingDelete(false) })
              }
            >
              {remove.isPending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              type="button"
              className="button"
              disabled={remove.isPending}
              onClick={() => setConfirmingDelete(false)}
            >
              Keep reminder
            </button>
          </div>
        </div>
      ) : (
        <div className="actions reminder-actions">
          {handled ? (
            <button
              type="button"
              className="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ acknowledged: false })}
              aria-label={`Re-open: ${reminder.text}`}
            >
              Re-open
            </button>
          ) : reminder.recurrence && !due ? null : (
            <button
              type="button"
              className={due ? 'button button-primary' : 'button'}
              disabled={update.isPending}
              onClick={() => update.mutate({ acknowledged: true })}
              aria-label={`Acknowledge: ${reminder.text}`}
            >
              Got it
            </button>
          )}
          <button
            type="button"
            className="button"
            onClick={() => setSharing((open) => !open)}
            aria-expanded={sharing}
            aria-label={`Share: ${reminder.text}`}
          >
            Share
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              update.reset();
              setEditing(true);
            }}
            aria-label={`Edit: ${reminder.text}`}
          >
            Edit
          </button>
          <button
            type="button"
            className="button button-danger-outline"
            onClick={() => {
              remove.reset();
              setConfirmingDelete(true);
            }}
            aria-label={`Delete: ${reminder.text}`}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
