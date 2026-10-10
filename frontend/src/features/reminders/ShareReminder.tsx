import { useId, useState, type FormEvent } from 'react';
import { errorMessage } from '../notes/useNotes';
import type { Reminder } from './remindersApi';
import { useRevokeShare, useShareReminder } from './useReminders';

/**
 * Notify another NoteFlow user about this reminder. The person is identified by the email of their
 * account (the server resolves it to a real user), never by a name typed here.
 */
export function ShareReminder({ reminder, onClose }: { reminder: Reminder; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [lastShared, setLastShared] = useState<string | null>(null);
  const share = useShareReminder(reminder.id);
  const revoke = useRevokeShare(reminder.id);
  const inputId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return setProblem('Enter the email address of the person to notify.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return setProblem('Enter a valid email address.');
    }
    setProblem(null);
    setLastShared(null);
    share.mutate(value, {
      onSuccess: (created) => {
        setEmail('');
        setLastShared(created.recipient.name);
      },
    });
  };

  const shownError = problem ?? (share.isError ? errorMessage(share.error) : null);

  return (
    <div className="share-panel" role="group" aria-label={`Share reminder: ${reminder.text}`}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={inputId}>Notify a NoteFlow user (their account email)</label>
          <div className="share-row">
            <input
              id={inputId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={share.isPending}
              autoComplete="off"
              placeholder="name@example.com"
            />
            <button type="submit" className="button button-primary" disabled={share.isPending}>
              {share.isPending ? 'Sharing…' : 'Share'}
            </button>
            <button type="button" className="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
        {shownError && (
          <p role="alert" className="alert alert-error">
            {shownError}
          </p>
        )}
        {lastShared && (
          <p role="status" className="muted">
            Shared with {lastShared}. They will see it in NoteFlow.
          </p>
        )}
      </form>

      {reminder.sharedWith.length > 0 && (
        <ul className="share-list" aria-label="Shared with">
          {reminder.sharedWith.map((s) => (
            <li key={s.shareId}>
              <span>
                {s.name} <span className="muted">({s.email})</span>
              </span>
              <button
                type="button"
                className="button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(s.shareId)}
                aria-label={`Stop sharing with ${s.name}`}
              >
                Stop sharing
              </button>
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <p role="alert" className="alert alert-error">
          {errorMessage(revoke.error)}
        </p>
      )}
    </div>
  );
}
