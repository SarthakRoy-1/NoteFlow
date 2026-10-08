import { Outlet, useMatch } from 'react-router-dom';
import { NoteList } from './NoteList';

/** Two-pane layout on desktop; on small screens only one pane is visible at a time. */
export function NotesPage() {
  const isIndex = useMatch({ path: '/notes', end: true });
  return (
    <div className="notes-layout" data-detail-open={isIndex ? 'false' : 'true'}>
      <NoteList />
      <div className="notes-detail-pane">
        <Outlet />
      </div>
    </div>
  );
}

export function NoNoteSelected() {
  return (
    <div className="detail-pane detail-empty">
      <p className="muted">Select a note to read it, or create a new one.</p>
    </div>
  );
}
