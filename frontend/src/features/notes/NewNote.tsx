import { Link, useNavigate } from 'react-router-dom';
import { NoteForm } from './NoteForm';
import { errorMessage, useCreateNote } from './useNotes';

export function NewNote() {
  const create = useCreateNote();
  const navigate = useNavigate();

  return (
    <div className="detail-pane">
      <Link to="/notes" className="back-link">
        ← All notes
      </Link>
      <h2>New note</h2>
      <NoteForm
        submitLabel="Save note"
        pending={create.isPending}
        error={create.isError ? errorMessage(create.error) : null}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (note) => navigate(`/notes/${note.id}`, { replace: true }),
          })
        }
        onCancel={() => navigate('/notes')}
      />
    </div>
  );
}
