import { Route, Routes } from 'react-router-dom';

function HomePage() {
  return (
    <main className="page">
      <h1>NoteFlow</h1>
      <p className="muted">Capture notes. Let AI turn them into todos and reminders.</p>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}
