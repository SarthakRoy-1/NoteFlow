import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BackIcon, Mark } from '../../components/icons';
import { LEGAL_LAST_UPDATED } from './legalInfo';
import { LegalLinks } from './LegalLinks';

/**
 * The shell of a public legal document. It needs no sign-in and makes no API call, so it renders
 * the same for visitors, for signed-in users and when the server is unreachable.
 */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  // Each document gets its own tab title (and Google's branding review reads it).
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · NoteFlow`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="back-link">
          <BackIcon />
          Back to NoteFlow
        </Link>
        <p className="legal-brand">
          <Mark size={20} />
          <span>NoteFlow</span>
        </p>
      </header>

      <main className="legal-main">
        <h1>{title}</h1>
        <p className="legal-meta">Last updated: {LEGAL_LAST_UPDATED}</p>
        <p className="legal-intro">{intro}</p>
        {children}
      </main>

      <footer className="legal-footer">
        <LegalLinks />
      </footer>
    </div>
  );
}

/** A titled section with an anchor, so a heading can be linked to directly. */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="legal-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}
