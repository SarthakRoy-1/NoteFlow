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

const DARK_OS = '(prefers-color-scheme: dark)';

/** The theme actually showing: the `data-theme` choice, or the OS setting under "system". */
export function activeTheme(): 'light' | 'dark' {
  const choice = document.documentElement.getAttribute('data-theme');
  if (choice === 'light' || choice === 'dark') return choice;
  return window.matchMedia?.(DARK_OS).matches ? 'dark' : 'light';
}

/** Calls `onChange` when `activeTheme()` may have changed (setting changed, or the OS flipped). */
export function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const os = window.matchMedia?.(DARK_OS);
  os?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    os?.removeEventListener('change', onChange);
  };
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
