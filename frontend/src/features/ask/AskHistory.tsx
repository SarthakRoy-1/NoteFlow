import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/time';
import type { Ask } from './askApi';
import { useAskHistory } from './useAsk';

interface Props {
  selectedId: string | null;
  onSelect: (ask: Ask) => void;
  timezone: string;
}

export function AskHistory({ selectedId, onSelect, timezone }: Props) {
  const { data, isPending, isError, error, refetch, isFetching } = useAskHistory();

  let body;
  if (isPending) {
    body = <p className="muted">Loading your history…</p>;
  } else if (isError) {
    body = (
      <div role="alert" className="alert alert-error">
        <p>
          {error instanceof ApiError ? error.message : 'We could not load your history.'} Please try
          again.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          Retry
        </button>
      </div>
    );
  } else if (data.length === 0) {
    body = <p className="muted">No questions yet. Your questions and answers will appear here.</p>;
  } else {
    body = (
      <ul className="ask-history-list">
        {data.map((ask) => (
          <li key={ask.id}>
            <button
              type="button"
              className={
                ask.id === selectedId ? 'ask-history-item is-selected' : 'ask-history-item'
              }
              aria-current={ask.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(ask)}
            >
              <span className="ask-history-q">{ask.question}</span>
              <span className="muted ask-history-meta">
                {formatDateTime(ask.createdAt, timezone)} · {ask.sources.length}{' '}
                {ask.sources.length === 1 ? 'source' : 'sources'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="ask-history" aria-label="Ask history">
      <h2>History</h2>
      {body}
    </section>
  );
}
