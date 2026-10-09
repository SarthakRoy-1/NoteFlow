import { useState, type FormEvent } from 'react';
import { useMe } from '../auth/useAuth';
import { errorMessage } from '../notes/useNotes';
import { AskAnswer } from './AskAnswer';
import { AskHistory } from './AskHistory';
import { QUESTION_MAX, type Ask } from './askApi';
import { useAskQuestion } from './useAsk';

export function AskPage() {
  const { data: me } = useMe();
  const timezone = me?.timezone ?? 'UTC';
  const ask = useAskQuestion();
  const [question, setQuestion] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Ask | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return setFieldError('Type a question first.');
    if (trimmed.length > QUESTION_MAX) {
      return setFieldError(`Questions can be at most ${QUESTION_MAX} characters.`);
    }
    setFieldError(null);
    ask.mutate(trimmed, {
      onSuccess: (result) => {
        setSelected(result);
        setQuestion('');
      },
    });
  };

  return (
    <section className="ask-page" aria-label="Ask AI">
      <div className="pane-header">
        <h1>Ask AI</h1>
      </div>
      <p className="muted">
        Ask a question about your saved notes. Answers use only your own notes, and the notes used
        are listed with each answer.
      </p>

      <div className="ask-layout">
        <div className="ask-main">
          <form className="ask-form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="ask-question" className="sr-only">
                Your question
              </label>
              <textarea
                id="ask-question"
                rows={3}
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                disabled={ask.isPending}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? 'ask-question-error' : undefined}
                placeholder="Ask your notes anything. For example: When is my Berlin trip?"
              />
              {fieldError && (
                <span id="ask-question-error" className="field-error">
                  {fieldError}
                </span>
              )}
            </div>
            <div className="actions">
              <button type="submit" className="button button-primary" disabled={ask.isPending}>
                {ask.isPending ? 'Asking…' : 'Ask'}
              </button>
              <span className="muted">
                {question.length}/{QUESTION_MAX}
              </span>
            </div>
          </form>

          {ask.isPending && (
            <p className="ask-thinking" role="status">
              Searching your notes and writing an answer…
            </p>
          )}
          {ask.isError && (
            <p role="alert" className="alert alert-error">
              {errorMessage(ask.error)}
            </p>
          )}

          {selected && <AskAnswer ask={selected} timezone={timezone} />}
        </div>
        <AskHistory selectedId={selected?.id ?? null} onSelect={setSelected} timezone={timezone} />
      </div>
    </section>
  );
}
