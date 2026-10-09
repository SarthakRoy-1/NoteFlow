import { Link } from 'react-router-dom';
import { formatDateTime } from '../../lib/time';
import type { Ask } from './askApi';

/** Question -> answer -> sources used. Read-only: a stored answer is never edited. */
export function AskAnswer({ ask, timezone }: { ask: Ask; timezone: string }) {
  return (
    <article className="ask-answer" aria-label="Answer">
      <p className="sr-only">Question</p>
      <p className="ask-question">{ask.question}</p>

      <p className="sr-only">Answer</p>
      {ask.status === 'no_info' && (
        <p className="badge ask-noinfo">Not enough information in your notes</p>
      )}
      <p className="ask-answer-text">{ask.answer}</p>

      <p className="ask-label">Sources used</p>
      {ask.sources.length === 0 ? (
        <p className="muted">No notes were used for this answer.</p>
      ) : (
        <ul className="ask-sources">
          {ask.sources.map((s, i) => (
            <li key={`${s.noteId ?? 'deleted'}-${i}`}>
              {s.noteId ? (
                <Link to={`/notes/${s.noteId}`}>{s.title}</Link>
              ) : (
                <span>
                  {s.title} <span className="muted">(note deleted)</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted ask-time">Asked {formatDateTime(ask.createdAt, timezone)}</p>
    </article>
  );
}
