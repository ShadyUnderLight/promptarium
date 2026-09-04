/**
 * Locale-aware formatting seam — the single place components should route
 * Date / Number formatting through, so future migrations never guess the OS
 * locale. Uses the same resolved locale as `t()`.
 */

import { locale } from './i18n.svelte';

export type DateLike = Date | number | string;

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Date only, e.g. `2026/09/04` in zh-CN. */
export function formatDate(
  value: DateLike,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return new Intl.DateTimeFormat(locale.resolved, options).format(toDate(value));
}

/** Date + time with a sensible default presentation. */
export function formatDateTime(
  value: DateLike,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return formatDate(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

/** Number with locale-aware grouping/decimals. */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(locale.resolved, options).format(value);
}
