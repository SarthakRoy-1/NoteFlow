import { useId, useState, type FormEvent } from 'react';
import { CONTENT_MAX, TITLE_MAX, type NoteInput } from './notesApi';

interface Props {
  initial?: NoteInput;
  submitLabel: string;
  pending: boolean;
  /** Server error to show above the buttons (already user-friendly). */
  error?: string | null;
  onSubmit: (values: NoteInput) => void;
  onCancel: () => void;
}

interface FieldErrors {
  title?: string;
  content?: string;
}

export function validateNote(values: NoteInput): FieldErrors {
  const errors: FieldErrors = {};
  const title = values.title.trim();
  const content = values.content.trim();
  if (!title) errors.title = 'Please enter a title.';
  else if (title.length > TITLE_MAX)
    errors.title = `Title must be at most ${TITLE_MAX} characters.`;
  if (!content) errors.content = 'Please write something in the note.';
  else if (content.length > CONTENT_MAX)
    errors.content = `Note text must be at most ${CONTENT_MAX.toLocaleString()} characters.`;
  return errors;
}

export function NoteForm({ initial, submitLabel, pending, error, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const titleId = useId();
  const contentId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateNote({ title, content });
    setErrors(found);
    if (found.title || found.content) return;
    onSubmit({ title: title.trim(), content: content.trim() });
  };

  return (
    <form className="note-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={titleId}>Title</label>
        <input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? `${titleId}-error` : undefined}
          disabled={pending}
          autoComplete="off"
        />
        {errors.title && (
          <p id={`${titleId}-error`} className="field-error">
            {errors.title}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={contentId}>Note</label>
        <textarea
          id={contentId}
          rows={10}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-invalid={Boolean(errors.content)}
          aria-describedby={errors.content ? `${contentId}-error` : undefined}
          disabled={pending}
        />
        {errors.content && (
          <p id={`${contentId}-error`} className="field-error">
            {errors.content}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? 'Saving and analysing…' : submitLabel}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
