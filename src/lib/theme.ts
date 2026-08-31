/**
 * Theme helpers — read/write the promptarium-theme preference that controls
 * the [data-theme] attribute on <html>.  The initial bootstrap is already
 * done by a tiny inline <script> in app.html so there is no FOUC.
 */

const STORAGE_KEY = 'promptarium-theme';

export type Theme = 'light' | 'dark';

/** Return the active theme ('light' | 'dark').
 *
 *  With no stored preference, falls back to the OS `prefers-color-scheme` —
 *  matching the pre-paint bootstrap in app.html EXACTLY. If this defaulted to
 *  'light' instead (as it once did), a dark-OS user with no saved choice would
 *  see a dark page whose toggle label read "Light" and whose first click was
 *  eaten (setting dark over dark, no visible change). The two must agree. */
export function getTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Toggle between light and dark, persist the choice, and update the
 * <html data-theme> attribute immediately.  Returns the new theme.
 */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(STORAGE_KEY, next);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', next);
  }
  return next;
}
