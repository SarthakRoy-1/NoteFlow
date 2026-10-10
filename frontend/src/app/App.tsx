import { Navigate, Route, Routes } from 'react-router-dom';
import { AskPage } from '../features/ask/AskPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage';
import { PasswordAuthOnly } from '../features/auth/PasswordAuthOnly';
import { RequireAuth } from '../features/auth/RequireAuth';
import { PrivacyPage } from '../features/legal/PrivacyPage';
import { TermsPage } from '../features/legal/TermsPage';
import { NewNote } from '../features/notes/NewNote';
import { NoteDetailRoute } from '../features/notes/NoteDetail';
import { NoNoteSelected, NotesPage } from '../features/notes/NotesPage';
import { RemindersPage } from '../features/reminders/RemindersPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TodosPage } from '../features/todos/TodosPage';
import { AppShell } from './AppShell';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Public: readable without signing in, and by direct link (Google's branding review). */}
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route
        path="/verify-email"
        element={
          <PasswordAuthOnly>
            <VerifyEmailPage />
          </PasswordAuthOnly>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PasswordAuthOnly>
            <ForgotPasswordPage />
          </PasswordAuthOnly>
        }
      />
      <Route
        path="/reset-password"
        element={
          <PasswordAuthOnly>
            <ResetPasswordPage />
          </PasswordAuthOnly>
        }
      />
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
        <Route path="/ask" element={<AskPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/notes" replace />} />
      </Route>
    </Routes>
  );
}
