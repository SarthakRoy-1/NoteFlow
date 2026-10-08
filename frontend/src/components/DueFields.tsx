import { useId } from 'react';
import { toInputDate, toInputTime } from '../lib/time';

/** What the user typed, in their timezone. Empty date = no due date. */
export interface DueState {
  date: string;
  time: string;
}

/** The shape the API accepts (see backend dueInput). `null` clears the due date. */
export type DueInput = { date: string; time: string | null } | null;

export function initialDue(dueAt: string | null, dueHasTime: boolean, timezone: string): DueState {
  if (!dueAt) return { date: '', time: '' };
  return {
    date: toInputDate(dueAt, timezone),
    time: dueHasTime ? toInputTime(dueAt, timezone) : '',
  };
}

export const dueChanged = (a: DueState, b: DueState) => a.date !== b.date || a.time !== b.time;

export const toDueInput = (state: DueState): DueInput =>
  state.date ? { date: state.date, time: state.time || null } : null;

/** A time needs a date; returns an error message or null. */
export function validateDue(state: DueState): string | null {
  return state.time && !state.date ? 'Choose a date for the time, or clear the time.' : null;
}

interface Props {
  value: DueState;
  onChange: (next: DueState) => void;
  timezone: string;
  disabled?: boolean;
}

export function DueFields({ value, onChange, timezone, disabled }: Props) {
  const dateId = useId();
  const timeId = useId();
  return (
    <>
      <div className="due-fields">
        <div className="field">
          <label htmlFor={dateId}>Due date</label>
          <input
            id={dateId}
            type="date"
            value={value.date}
            // Clearing the date removes the due date entirely, so a leftover time is cleared with it.
            onChange={(e) =>
              onChange({ date: e.target.value, time: e.target.value ? value.time : '' })
            }
            disabled={disabled}
          />
        </div>
        <div className="field">
          <label htmlFor={timeId}>Due time (optional)</label>
          <input
            id={timeId}
            type="time"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>
      <p className="muted due-hint">
        Times are in your timezone ({timezone}). Clear the date to remove the due date.
      </p>
    </>
  );
}
