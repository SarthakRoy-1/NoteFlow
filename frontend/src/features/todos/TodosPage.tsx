import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useMe } from '../auth/useAuth';
import { TodoItem } from './TodoItem';
import { useTodos } from './useTodos';

type Filter = 'all' | 'open' | 'done';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Completed' },
];

export function TodosPage() {
  const { data: me } = useMe();
  const { data, isPending, isError, error, refetch, isFetching } = useTodos();
  const [filter, setFilter] = useState<Filter>('all');
  const timezone = me?.timezone ?? 'UTC';

  let body;
  if (isPending) {
    body = <p className="muted">Loading your todos…</p>;
  } else if (isError) {
    body = (
      <div role="alert" className="alert alert-error">
        <p>
          {error instanceof ApiError ? error.message : 'We could not load your todos.'} Please try
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
    body = (
      <div className="empty">
        <p>
          <strong>No todos yet.</strong>
        </p>
        <p className="muted">
          Write a note such as “buy milk tomorrow” and the AI will add a todo here.
        </p>
        <Link className="button button-primary" to="/notes/new">
          Write a note
        </Link>
      </div>
    );
  } else {
    const visible = data.filter((t) =>
      filter === 'all' ? true : filter === 'open' ? !t.completed : t.completed,
    );
    body =
      visible.length === 0 ? (
        <p className="muted">
          {filter === 'open' ? 'No open todos. Nice work!' : 'No completed todos yet.'}
        </p>
      ) : (
        <ul className="todo-list" aria-label="Your todos">
          {visible.map((todo) => (
            <TodoItem key={todo.id} todo={todo} timezone={timezone} />
          ))}
        </ul>
      );
  }

  const openCount = data?.filter((t) => !t.completed).length ?? 0;
  const doneCount = (data?.length ?? 0) - openCount;

  return (
    <section className="todos-page" aria-label="Todos">
      <div className="pane-header">
        <h1>Todos</h1>
        {data && data.length > 0 && (
          <span className="muted">
            {openCount} open · {doneCount} completed
          </span>
        )}
      </div>
      {data && data.length > 0 && (
        <div className="filters" role="group" aria-label="Filter todos">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={filter === f.value ? 'chip chip-active' : 'chip'}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {body}
    </section>
  );
}
