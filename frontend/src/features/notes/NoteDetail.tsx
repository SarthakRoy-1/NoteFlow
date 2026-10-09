import { useState } from 'react';
import { BackIcon } from '../../components/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { AnalysisPanel } from './AnalysisPanel';
import { DerivedItems } from './DerivedItems';
import { formatDateTime } from '../../lib/time';
import { useMe } from '../auth/useAuth';
import { NoteForm } from './NoteForm';
import { errorMessage, useDeleteNote, useNote, useUpdateNote } from './useNotes';

const BackLink = () => (
  <Link to="/notes" className="back-link">
    <BackIcon />
    All notes
  </Link>
);

/** Route wrapper: `key` resets edit/confirm state when switching between notes. */
export function NoteDetailRoute() {
  const { id = '' } = useParams();
  return <NoteDetail key={id} id={id} />;
}

function NoteDetail({ id }: { id: string }) {
  const { data: note, isPending, isError, error, refetch } = useNote(id);
  const timezone = useMe().data?.timezone ?? 'UTC';
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const update = useUpdateNote(id);
  const remove = useDeleteNote(id);
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div className="detail-pane">
        <BackLink />
        <p className="muted">Loading note…</p>
      </div>
    );
  }
  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div className="detail-pane">
        <BackLink />
        <div role="alert" className="alert alert-error">
          <p>{missing ? 'This note no longer exists.' : errorMessage(error)}</p>
          {!missing && (
            <button type="button" className="button" onClick={() => void refetch()}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="detail-pane">
        <BackLink />
        <h2 className="form-heading">Edit note</h2>
        <NoteForm
          initial={{ title: note.title, content: note.content }}
          submitLabel="Save changes"
          pending={update.isPending}
          error={update.isError ? errorMessage(update.error) : null}
          onSubmit={(values) =>
            update.mutate(values, {
              onSuccess: () => setEditing(false),
            })
          }
          onCancel={() => {
            update.reset();
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <article className="detail-pane">
      <BackLink />
      <h2>{note.title}</h2>
      <p className="muted note-meta">
        Updated {formatDateTime(note.updatedAt, timezone)} · Created{' '}
        {formatDateTime(note.createdAt, timezone)}
      </p>
      <p className="note-content">{note.content}</p>
      <AnalysisPanel noteId={note.id} analysis={note.analysis} />
      <DerivedItems noteId={note.id} />

      {remove.isError && (
        <p role="alert" className="alert alert-error">
          {errorMessage(remove.error)}
        </p>
      )}

      {confirmingDelete ? (
        <div className="confirm" role="group" aria-label="Confirm delete">
          <p>Delete this note permanently? This cannot be undone.</p>
          <div className="actions">
            <button
              type="button"
              className="button button-danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => navigate('/notes', { replace: true }),
                  onSettled: () => setConfirmingDelete(false),
                })
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
              Keep note
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="button button-danger-outline"
            onClick={() => {
              remove.reset();
              setConfirmingDelete(true);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
