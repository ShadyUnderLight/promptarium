/**
 * App locale state and `t()` — the single i18n entry point every component
 * uses. Nothing about locale state / catalogs / resolution lives outside this
 * module (and `format.ts`, which shares the same `locale` object).
 *
 * Preference persistence follows the established theme pattern
 * (`src/lib/theme.ts`): app-private localStorage key `promptarium-locale`,
 * legal values `system | en | zh-CN`, missing/invalid → `system`.
 */

import { en } from './locales/en';
import type { MessageKey } from './locales/en';
import { zhCN } from './locales/zh-CN';
import type { MessageParams, LocalePreference, ResolvedLocale } from './types';
import { normalizePreference, resolveSystemLocale } from './resolve';

const STORAGE_KEY = 'promptarium-locale';

/** Every catalog is guaranteed to cover the full canonical key set. */
const catalogs: Record<ResolvedLocale, Record<MessageKey, string>> = {
  en,
  'zh-CN': zhCN,
};

/** Reactive app locale state. `resolved` is what rendering actually uses. */
export const locale = $state<{ preference: LocalePreference; resolved: ResolvedLocale }>({
  preference: readPreference(),
  resolved: 'en',
});

// Resolve once at module load and keep `<html lang>` in sync. This app is an
// SPA (`ssr = false`), so `document` always exists here; the default `en` in
// app.html is overwritten before the first painted frame.
applyResolved();

function readPreference(): LocalePreference {
  if (typeof localStorage === 'undefined') return 'system';
  return normalizePreference(localStorage.getItem(STORAGE_KEY));
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

function applyResolved(): void {
  const resolved: ResolvedLocale =
    locale.preference === 'system' ? resolveSystemLocale(systemLanguages()) : locale.preference;
  locale.resolved = resolved;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = resolved;
  }
}

/** Read a message with a lenient lookup so a runtime gap can never crash the
 *  app: missing key falls back to English, then to the raw key — never
 *  `undefined`. */
function readMessage(catalog: Record<MessageKey, string>, key: MessageKey): string | undefined {
  return (catalog as Record<string, string | undefined>)[key];
}

/** Replace `{name}` placeholders with `params`. Exported so the interpolation
 *  behavior itself is unit-testable independently of catalog content. */
export function interpolateMessage(text: string, params?: MessageParams): string {
  if (!params) return text;
  let out = text;
  for (const [name, value] of Object.entries(params)) {
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
}

/**
 * Translate a semantic key into the active locale. Supports simple
 * `{name}` interpolation. Reactively re-renders when the locale changes.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  let text = readMessage(catalogs[locale.resolved], key);
  if (text === undefined) text = readMessage(en, key);
  if (text === undefined) return key;
  return interpolateMessage(text, params);
}

/** Persist a manual choice and apply it immediately — no restart required. */
export function setPreference(pref: LocalePreference): void {
  if (pref !== 'system' && pref !== 'en' && pref !== 'zh-CN') return;
  locale.preference = pref;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, pref);
  }
  applyResolved();
}
