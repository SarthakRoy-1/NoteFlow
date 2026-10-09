export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'noteflow-theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system'; // storage can be blocked (private windows); fall back to the OS setting
  }
}

/** Sets or clears `data-theme`; tokens.css maps it to `color-scheme`, which drives every colour. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not persisted, but the choice still applies for this visit.
  }
  applyTheme(choice);
}
