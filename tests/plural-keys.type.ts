/**
 * Type-only guard for `tPlural()` (Issue #36 review): a typo'd plural base
 * must be a compile error, same discipline as `t()`'s `MessageKey` param.
 * `pnpm check` fails if either directive below stops holding.
 */
import { tPlural } from '../src/lib/i18n/i18n.svelte';

// Valid base: both `toolbar.count.one` and `toolbar.count.other` exist.
tPlural('toolbar.count', 1);

// @ts-expect-error — typo'd base (`toolbar.cout`) must not type-check.
tPlural('toolbar.cout', 1);

// @ts-expect-error — a full message key is not a plural base.
tPlural('toolbar.count.one', 1);
