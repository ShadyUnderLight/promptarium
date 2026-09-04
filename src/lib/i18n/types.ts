/**
 * Core i18n types shared by the locale store, the catalogs and the formatting
 * seam. `MessageKey` is derived from the English catalog (the canonical key
 * contract) in `locales/en.ts`.
 */

/** What the user has chosen, or `system` to follow the OS language. */
export type LocalePreference = 'system' | 'en' | 'zh-CN';

/** The locale actually in effect for rendering. */
export type ResolvedLocale = 'en' | 'zh-CN';

/** Interpolation params, e.g. `t('update.available', { version: '0.4.0' })`. */
export interface MessageParams {
  [name: string]: string | number;
}
