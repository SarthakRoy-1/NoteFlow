import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mark } from '../../components/icons';

/** Shell for the single-purpose pages reached from an email link (verify, forgot, reset). */
export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <Link to="/login" className="login-brand">
        <Mark size={26} />
        <span>NoteFlow</span>
      </Link>
      <h1 className="auth-page-title">{title}</h1>
      {children}
    </main>
  );
}
