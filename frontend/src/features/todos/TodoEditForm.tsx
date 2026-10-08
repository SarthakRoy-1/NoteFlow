import { useId, useState, type FormEvent } from 'react';
import {
  DueFields,
  dueChanged,
  initialDue,
  toDueInput,
  validateDue,
  type DueState,
} from '../../components/DueFields';
import { TODO_TITLE_MAX, type Todo, type TodoChanges } from './todosApi';

interface Props {
  todo: Todo;
  timezone: string;
  pending: boolean;
  error: string | null;
  onSave: (changes: TodoChanges) => void;
  onCancel: () => void;
}

/** Edits only what the API allows: the text and the due date/time. Sends only what changed. */
export function TodoEditForm({ todo, timezone, pending, error, onSave, onCancel }: Props) {
  const initial = initialDue(todo.dueAt, todo.dueHasTime, timezone);
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState<DueState>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const titleId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return setProblem('Please enter the todo text.');
    if (trimmed.length > TODO_TITLE_MAX) {
      return setProblem(`Todo text must be at most ${TODO_TITLE_MAX} characters.`);
    }
    const dueProblem = validateDue(due);
    if (dueProblem) return setProblem(dueProblem);
    setProblem(null);

    const changes: TodoChanges = {};
    if (trimmed !== todo.title) changes.title = trimmed;
    if (dueChanged(due, initial)) changes.due = toDueInput(due);
    if (Object.keys(changes).length === 0) return onCancel(); // nothing to save
    onSave(changes);
  };

  const shownError = problem ?? error;

  return (
    <form className="todo-edit" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={titleId}>Todo</label>
        <input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          autoComplete="off"
        />
      </div>
      <DueFields value={due} onChange={setDue} timezone={timezone} disabled={pending} />
      {shownError && (
        <p role="alert" className="alert alert-error">
          {shownError}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
