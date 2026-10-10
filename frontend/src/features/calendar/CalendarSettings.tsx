import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe } from '../auth/useAuth';
import { errorMessage } from '../notes/useNotes';
import {
  disconnectCalendar,
  fetchCalendarStatus,
  startCalendarConnect,
  syncCalendar,
  type CalendarSyncResult,
} from './calendarApi';

const CALENDAR_KEY = ['calendar'] as const;

/** What the Google redirect (?calendar=...) tells the user, shown once. */
const RESULTS: Record<string, { tone: 'ok' | 'problem'; text: string }> = {
  connected: {
    tone: 'ok',
    text: 'Google Calendar is connected. New reminders will be added to it.',
  },
  declined: {
    tone: 'problem',
    text: 'Calendar access was not allowed, so nothing was connected. You can try again any time.',
  },
  mismatch: {
    tone: 'problem',
    text: 'That Google account is not the one you are signed in with. Choose your own account and try again.',
  },
  error: { tone: 'problem', text: 'We could not connect Google Calendar. Please try again.' },
};

export function CalendarSettings() {
  const qc = useQueryClient();
  const { data: user } = useMe();
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<{ tone: 'ok' | 'problem'; text: string } | null>(null);

  // Show the outcome of the Google round trip once, then clean the address bar.
  const outcome = params.get('calendar');
  useEffect(() => {
    if (outcome === null) return;
    setResult(RESULTS[outcome] ?? null);
    const next = new URLSearchParams(params);
    next.delete('calendar');
    setParams(next, { replace: true });
  }, [outcome, params, setParams]);

  const status = useQuery({
    queryKey: [...CALENDAR_KEY, user?.id ?? null],
    queryFn: fetchCalendarStatus,
    enabled: Boolean(user),
  });
  const connect = useMutation({
    mutationFn: startCalendarConnect,
    onSuccess: (url) => window.location.assign(url),
  });
  const disconnect = useMutation({
    mutationFn: disconnectCalendar,
    onSuccess: () => qc.invalidateQueries({ queryKey: CALENDAR_KEY }),
  });

  const sync = useMutation({
    mutationFn: syncCalendar,
    // A refused permission changes what the page shows, so refresh the connection state.
    onSuccess: () => qc.invalidateQueries({ queryKey: CALENDAR_KEY }),
  });

  const data = status.data;
  const needsReconnect = data?.status === 'needs_reconnect';

  return (
    <section className="settings-row settings-card" aria-labelledby="calendar-heading">
      <div className="settings-label">
        <h2 id="calendar-heading">Google Calendar</h2>
        <p className="muted">
          Add each reminder that has a date and time to your Google Calendar, and keep it up to date
          when you edit it.
        </p>
      </div>
      <div className="settings-control">
        {status.isPending && <p className="muted">Loading…</p>}
        {status.isError && (
          <p role="alert" className="alert alert-error">
            {errorMessage(status.error)}
          </p>
        )}
        {result && (
          <p
            role={result.tone === 'ok' ? 'status' : 'alert'}
            className={result.tone === 'ok' ? 'muted' : 'alert alert-error'}
          >
            {result.text}
          </p>
        )}

        {data && !data.available && (
          <p className="muted">Google Calendar is not set up on this server.</p>
        )}

        {data?.available && data.connected && (
          <>
            <p>
              Connected{data.googleEmail ? ` as ${data.googleEmail}` : ''}. Reminders you save from
              now on appear in that calendar. Reminders you saved earlier are added when you press
              &ldquo;Sync existing reminders&rdquo;; a reminder without a time is never added.
            </p>
            {sync.data && <SyncOutcome outcome={sync.data} />}
            {sync.isError && (
              <p role="alert" className="alert alert-error">
                {errorMessage(sync.error)}
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
              >
                {sync.isPending ? 'Syncing…' : 'Sync existing reminders'}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? 'Disconnecting…' : 'Disconnect Google Calendar'}
              </button>
            </div>
          </>
        )}

        {data?.available && !data.connected && (
          <>
            {needsReconnect && (
              <p role="alert" className="alert alert-error">
                Google no longer accepts NoteFlow&apos;s calendar permission, so new reminders are
                not being added. Reconnect to continue.
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => connect.mutate()}
                disabled={connect.isPending}
              >
                {connect.isPending
                  ? 'Opening Google…'
                  : needsReconnect
                    ? 'Reconnect Google Calendar'
                    : 'Connect Google Calendar'}
              </button>
              {needsReconnect && (
                <button
                  type="button"
                  className="button"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  Remove connection
                </button>
              )}
            </div>
            <p className="muted">
              Google will ask you to allow NoteFlow to create and edit events on your calendar.
              NoteFlow only touches the events it creates for your reminders. You can disconnect at
              any time.
            </p>
          </>
        )}

        {connect.isError && (
          <p role="alert" className="alert alert-error">
            {errorMessage(connect.error)}
          </p>
        )}
        {disconnect.isError && (
          <p role="alert" className="alert alert-error">
            {errorMessage(disconnect.error)}
          </p>
        )}
      </div>
    </section>
  );
}

/** The result of one "Sync existing reminders" press, including what could not be sent. */
function SyncOutcome({ outcome }: { outcome: CalendarSyncResult }) {
  if (outcome.result === 'needs_reconnect') {
    return (
      <p role="alert" className="alert alert-error">
        Google no longer accepts NoteFlow&apos;s calendar permission. Reconnect Google Calendar to
        continue.
      </p>
    );
  }
  const pending = outcome.remaining; // failed ones are still waiting, so they are counted here
  if (pending > 0) {
    return (
      <p role="alert" className="alert alert-error">
        {outcome.synced} added or updated. {pending} could not be sent right now (Google had a
        temporary problem). They are still saved in NoteFlow; press the button to try again.
      </p>
    );
  }
  return (
    <p role="status" className="muted">
      {outcome.synced === 0
        ? 'Everything is already up to date in Google Calendar.'
        : `${outcome.synced} reminder${outcome.synced === 1 ? '' : 's'} added or updated in Google Calendar.`}
    </p>
  );
}
