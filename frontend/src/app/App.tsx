import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { NewNote } from '../features/notes/NewNote';
import { NoteDetailRoute } from '../features/notes/NoteDetail';
import { NoNoteSelected, NotesPage } from '../features/notes/NotesPage';
import { RemindersPage } from '../features/reminders/RemindersPage';
import { TodosPage } from '../features/todos/TodosPage';
import { AppShell } from './AppShell';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/notes" replace />} />
        <Route path="/notes" element={<NotesPage />}>
          <Route index element={<NoNoteSelected />} />
          <Route path="new" element={<NewNote />} />
          <Route path=":id" element={<NoteDetailRoute />} />
        </Route>
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/reminders" element={<RemindersPage />} />
        <Route path="*" element={<Navigate to="/notes" replace />} />
      </Route>
    </Routes>
  );
}
