import { Link, NavLink } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/time';
import { useMe } from '../auth/useAuth';
import { useNotesList } from './useNotes';

export function NoteList() {
  const { data, isPending, isError, error, refetch, isFetching } = useNotesList();
  const { data: me } = useMe();
  const timezone = me?.timezone ?? 'UTC';

  let body;
  if (isPending) {
    body = <p className="muted">Loading your notes…</p>;
  } else if (isError) {
    body = (
      <div role="alert" className="alert alert-error">
        <p>
          {error instanceof ApiError ? error.message : 'We could not load your notes.'} Please try
          again.
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
          <strong>No notes yet.</strong>
        </p>
        <p className="muted">Write your first note and it will show up here.</p>
        <Link className="button button-primary" to="/notes/new">
          Create your first note
        </Link>
      </div>
    );
  } else {
    body = (
      <ul className="note-list" aria-label="Your notes">
        {data.map((note) => (
          <li key={note.id}>
            <NavLink
              to={`/notes/${note.id}`}
              className={({ isActive }) => (isActive ? 'note-item active' : 'note-item')}
            >
              <span className="note-item-title">{note.title}</span>
              <span className="note-item-preview">{note.preview}</span>
              <span className="note-item-date">{formatDateTime(note.updatedAt, timezone)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="notes-list-pane" aria-label="Notes">
      <div className="pane-header">
        <h1>Notes</h1>
        <Link className="button button-primary" to="/notes/new">
          New note
        </Link>
      </div>
      {body}
    </section>
  );
}
