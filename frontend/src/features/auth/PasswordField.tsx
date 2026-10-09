import { useState } from 'react';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  hint?: string;
  disabled?: boolean;
}

/** Password input with a show/hide button, an inline error and an optional hint. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  disabled,
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-row">
        <input
          id={id}
          name={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
        />
        <button
          type="button"
          className="link-button password-toggle"
          aria-pressed={shown}
          aria-label="Show password"
          onClick={() => setShown((v) => !v)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
