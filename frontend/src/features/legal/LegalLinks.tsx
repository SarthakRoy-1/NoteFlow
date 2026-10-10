import { Link } from 'react-router-dom';

/** The two legal links, used in the sign-in screen, Settings and the legal pages themselves. */
export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Legal">
      <Link to="/privacy">Privacy Policy</Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms">Terms of Service</Link>
    </nav>
  );
}
