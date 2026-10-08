import { useId, useState, type FormEvent } from 'react';
import {
  DueFields,
  dueChanged,
  initialDue,
  toDueInput,
  validateDue,
  type DueState,
} from '../../components/DueFields';
import {
  REMINDER_PERSON_MAX,
  REMINDER_TEXT_MAX,
  type Reminder,
  type ReminderChanges,
} from './remindersApi';

interface Props {
  reminder: Reminder;
  timezone: string;
  pending: boolean;
  error: string | null;
  onSave: (changes: ReminderChanges) => void;
  onCancel: () => void;
}

/** Edits only what the API allows: text, person and due date/time. Sends only what changed. */
export function ReminderEditForm({ reminder, timezone, pending, error, onSave, onCancel }: Props) {
  const initial = initialDue(reminder.dueAt, reminder.dueHasTime, timezone);
  const [text, setText] = useState(reminder.text);
  const [person, setPerson] = useState(reminder.person ?? '');
  const [due, setDue] = useState<DueState>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const textId = useId();
  const personId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedText = text.trim();
    const trimmedPerson = person.trim();
    if (!trimmedText) return setProblem('Please enter the reminder text.');
    if (trimmedText.length > REMINDER_TEXT_MAX) {
      return setProblem(`Reminder text must be at most ${REMINDER_TEXT_MAX} characters.`);
    }
    if (trimmedPerson.length > REMINDER_PERSON_MAX) {
      return setProblem(`Person must be at most ${REMINDER_PERSON_MAX} characters.`);
    }
    const dueProblem = validateDue(due);
    if (dueProblem) return setProblem(dueProblem);
    setProblem(null);

    const changes: ReminderChanges = {};
    if (trimmedText !== reminder.text) changes.text = trimmedText;
    if (trimmedPerson !== (reminder.person ?? '')) changes.person = trimmedPerson || null;
    if (dueChanged(due, initial)) changes.due = toDueInput(due);
    if (Object.keys(changes).length === 0) return onCancel(); // nothing to save
    onSave(changes);
  };

  const shownError = problem ?? error;

  return (
    <form className="todo-edit" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={textId}>Reminder</label>
        <input
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor={personId}>Person (optional)</label>
        <input
          id={personId}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
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
