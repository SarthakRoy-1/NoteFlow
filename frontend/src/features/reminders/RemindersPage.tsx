import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useMe } from '../auth/useAuth';
import { SharedWithYou } from '../shares/SharedWithYou';
import { PendingReminders } from './PendingReminders';
import { ReminderItem, isReminderDue } from './ReminderItem';
import type { Reminder } from './remindersApi';
import { useDueReminders, useReminders } from './useReminders';

function Section({
  title,
  reminders,
  timezone,
}: {
  title: string;
  reminders: Reminder[];
  timezone: string;
}) {
  if (reminders.length === 0) return null;
  return (
    <section className="reminder-section" aria-label={title}>
      <h2>
        {title} <span className="muted">({reminders.length})</span>
      </h2>
      <ul className="todo-list">
        {reminders.map((r) => (
          <ReminderItem key={r.id} reminder={r} timezone={timezone} />
        ))}
      </ul>
    </section>
  );
}

export function RemindersPage() {
  const { data: me } = useMe();
  const { data, isPending, isError, error, refetch, isFetching } = useReminders();
  // Subscribing to the alert query re-renders this page at the moment a reminder comes due, so it
  // moves from "Upcoming" to "Due now" without waiting for a refocus or a reload.
  useDueReminders();
  const timezone = me?.timezone ?? 'UTC';

  let body;
  if (isPending) {
    body = <p className="muted">Loading your reminders…</p>;
  } else if (isError) {
    body = (
      <div role="alert" className="alert alert-error">
        <p>
          {error instanceof ApiError ? error.message : 'We could not load your reminders.'} Please
          try again.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          Retry
        </button>
      </div>
    );
  } else if (data.length === 0) {
    body = (
      <div className="empty">
        <p>
          <strong>No reminders yet.</strong>
        </p>
        <p className="muted">
          Write a note such as “remind John to send the invoice by Friday 5pm” and the AI will add a
          reminder here.
        </p>
        <Link className="button button-primary" to="/notes/new">
          Write a note
        </Link>
      </div>
    );
  } else {
    const now = new Date();
    const dueNow = data.filter((r) => isReminderDue(r, now));
    const upcoming = data.filter(
      (r) => r.status === 'pending' && r.dueAt !== null && !isReminderDue(r, now),
    );
    const noTime = data.filter((r) => r.status === 'pending' && r.dueAt === null);
    const handled = data.filter((r) => r.status !== 'pending');
    body = (
      <>
        <Section title="Due now" reminders={dueNow} timezone={timezone} />
        <Section title="Upcoming" reminders={upcoming} timezone={timezone} />
        <Section title="No time set" reminders={noTime} timezone={timezone} />
        <Section title="Acknowledged" reminders={handled} timezone={timezone} />
      </>
    );
  }

  return (
    <section className="todos-page" aria-label="Reminders">
      <div className="pane-header">
        <h1>Reminders</h1>
      </div>
      <SharedWithYou timezone={timezone} />
      <PendingReminders timezone={timezone} />
      {body}
    </section>
  );
}
