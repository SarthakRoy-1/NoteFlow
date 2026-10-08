import type { Analysis } from './notesApi';
import { errorMessage, useRetryAnalysis } from './useNotes';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function analysisSummary({ todos, reminders }: Analysis): string {
  if (todos === 0 && reminders === 0) {
    return 'AI found nothing in this note to turn into a todo or reminder.';
  }
  const parts = [
    todos > 0 ? plural(todos, 'todo') : null,
    reminders > 0 ? plural(reminders, 'reminder') : null,
  ].filter(Boolean);
  return `AI found ${parts.join(' and ')} in this note.`;
}

/** Shows what the AI did with this note, and lets the user retry when it could not run. */
export function AnalysisPanel({ noteId, analysis }: { noteId: string; analysis: Analysis }) {
  const retry = useRetryAnalysis(noteId);

  if (analysis.status === 'ok') {
    return (
      <p className="analysis analysis-ok" role="status">
        {analysisSummary(analysis)}
      </p>
    );
  }

  const message =
    analysis.status === 'failed'
      ? (analysis.error ?? 'AI analysis failed. Your note was saved.')
      : 'AI analysis has not finished for this note. Your note was saved.';

  return (
    <div className="analysis analysis-problem" role="alert">
      <p>{message}</p>
      {retry.isError && <p className="field-error">{errorMessage(retry.error)}</p>}
      <button
        type="button"
        className="button"
        onClick={() => retry.mutate()}
        disabled={retry.isPending}
      >
        {retry.isPending ? 'Analysing…' : 'Retry analysis'}
      </button>
    </div>
  );
}
