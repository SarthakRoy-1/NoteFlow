import type { ReactNode } from 'react';

/** One stroke weight (1.6) on a 20px grid, so every icon reads as the same hand. Decorative only. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const NotesIcon = () => (
  <Icon>
    <path d="M5 2.75h7.5L16 6.25V16a1.25 1.25 0 0 1-1.25 1.25h-9.5A1.25 1.25 0 0 1 4 16V4A1.25 1.25 0 0 1 5.25 2.75z" />
    <path d="M7 10h6M7 13h4" />
  </Icon>
);

export const TodosIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7" />
    <path d="m6.9 10.2 2.2 2.2 4-4.4" />
  </Icon>
);

export const RemindersIcon = () => (
  <Icon>
    <path d="M5 8a5 5 0 0 1 10 0c0 4.5 1.5 5.5 1.5 5.5h-13S5 12.5 5 8z" />
    <path d="M8.25 16.25a1.9 1.9 0 0 0 3.5 0" />
  </Icon>
);

export const AskIcon = () => (
  <Icon>
    <path d="M3.5 4.5h13v9h-6.25L6.5 16.75V13.5h-3z" />
    <path d="M7.25 8h5.5M7.25 10.5h3" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="M12 4.5 6.5 10l5.5 5.5" />
  </Icon>
);

/** The mark: a page whose last line trails off into a marker dot. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="mark-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="2.5" width="18" height="19" rx="3.5" fill="currentColor" />
      <path
        d="M7.5 8.5h9M7.5 12.25h9"
        stroke="var(--paper)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M7.5 16h4" stroke="var(--paper)" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="15.2" cy="16" r="1.25" fill="var(--marker)" />
    </svg>
  );
}

export const GoogleG = () => (
  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34A9 9 0 0 0 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
    />
  </svg>
);
