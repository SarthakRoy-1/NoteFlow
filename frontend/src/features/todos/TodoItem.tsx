import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDue, isPast } from '../../lib/time';
import { errorMessage } from '../notes/useNotes';
import { TodoEditForm } from './TodoEditForm';
import type { Todo } from './todosApi';
import { useDeleteTodo, useUpdateTodo } from './useTodos';

export function TodoItem({ todo, timezone }: { todo: Todo; timezone: string }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const update = useUpdateTodo(todo.id);
  const remove = useDeleteTodo(todo.id);
  const checkId = useId();

  const overdue = !todo.completed && todo.dueAt !== null && isPast(todo.dueAt);
  const rowError = update.isError && !editing ? errorMessage(update.error) : null;

  if (editing) {
    return (
      <li className="todo-item todo-item-editing">
        <TodoEditForm
          todo={todo}
          timezone={timezone}
          pending={update.isPending}
          error={update.isError ? errorMessage(update.error) : null}
          onSave={(changes) => update.mutate(changes, { onSuccess: () => setEditing(false) })}
          onCancel={() => {
            update.reset();
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={todo.completed ? 'todo-item todo-done' : 'todo-item'}>
      <div className="todo-main">
        <input
          id={checkId}
          type="checkbox"
          className="todo-check"
          checked={todo.completed}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ completed: e.target.checked })}
          aria-label={`${todo.completed ? 'Mark as not done' : 'Mark as done'}: ${todo.title}`}
        />
        <div className="todo-body">
          <span className="todo-title">{todo.title}</span>
          <div className="todo-meta">
            {todo.dueAt && (
              <span className={overdue ? 'todo-due todo-overdue' : 'todo-due'}>
                Due {formatDue(todo.dueAt, todo.dueHasTime, timezone)}
                {overdue && ' · Overdue'}
              </span>
            )}
            {todo.createdByAi && <span className="badge">AI-created</span>}
            {todo.completed && <span className="badge badge-done">Done</span>}
            <Link className="todo-source" to={`/notes/${todo.sourceNote.id}`}>
              From note: {todo.sourceNote.title}
            </Link>
          </div>
        </div>
      </div>

      {rowError && (
        <p role="alert" className="alert alert-error">
          {rowError}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="alert alert-error">
          {errorMessage(remove.error)}
        </p>
      )}

      {confirmingDelete ? (
        <div className="confirm" role="group" aria-label={`Confirm delete: ${todo.title}`}>
          <p>Delete this todo? The note it came from is not affected.</p>
          <div className="actions">
            <button
              type="button"
              className="button button-danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, { onSettled: () => setConfirmingDelete(false) })
              }
            >
              {remove.isPending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              type="button"
              className="button"
              disabled={remove.isPending}
              onClick={() => setConfirmingDelete(false)}
            >
              Keep todo
            </button>
          </div>
        </div>
      ) : (
        <div className="actions todo-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              update.reset();
              setEditing(true);
            }}
            aria-label={`Edit: ${todo.title}`}
          >
            Edit
          </button>
          <button
            type="button"
            className="button button-danger-outline"
            onClick={() => {
              remove.reset();
              setConfirmingDelete(true);
            }}
            aria-label={`Delete: ${todo.title}`}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
