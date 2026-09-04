/**
 * Pure locale resolution helpers — no Svelte, no DOM, fully unit-testable.
 *
 * Resolution rules (Issue #35):
 *  - walk `navigator.languages` in order; the first clearly-supported locale
 *    wins;
 *  - `zh` / `zh-CN` / `zh-SG` / `zh-Hans-*` → `zh-CN`;
 *  - `en` / `en-*` → `en`;
 *  - Traditional Chinese (`zh-TW` / `zh-HK` / `zh-Hant-*`) must NOT be mapped
 *    onto Simplified Chinese while there is no Traditional catalog — it is
 *    skipped like any unsupported locale and English is the fallback;
 *  - no supported locale anywhere → `en`.
 */

import type { LocalePreference, ResolvedLocale } from './types';

export const LOCALE_PREFERENCES: readonly LocalePreference[] = ['system', 'en', 'zh-CN'];

function normalizeLanguage(lang: string): string {
  return lang.toLowerCase().replace(/_/g, '-');
}

/** `zh`, `zh-CN`, `zh-SG`, `zh-Hans`, `zh-Hans-TW`, … */
function isSimplifiedChinese(lang: string): boolean {
  return (
    lang === 'zh' ||
    lang.startsWith('zh-cn') ||
    lang.startsWith('zh-hans') ||
    lang.startsWith('zh-sg')
  );
}

/** `en`, `en-US`, `en-GB`, … */
function isEnglish(lang: string): boolean {
  return lang === 'en' || lang.startsWith('en-');
}

/**
 * Resolve a system language list to a supported locale. Any unsupported
 * entry (including `zh-TW`/`zh-HK`/`zh-Hant-*`) is skipped, so a list like
 * `['zh-TW', 'en-US']` resolves to `en`, not to Simplified Chinese.
 */
export function resolveSystemLocale(languages: readonly string[] = []): ResolvedLocale {
  for (const raw of languages) {
    const lang = normalizeLanguage(raw);
    if (isSimplifiedChinese(lang)) return 'zh-CN';
    if (isEnglish(lang)) return 'en';
  }
  return 'en';
}

/** Only the three legal stored values are accepted; anything else → `system`. */
export function normalizePreference(value: string | null): LocalePreference {
  return value === 'en' || value === 'zh-CN' || value === 'system' ? value : 'system';
}
