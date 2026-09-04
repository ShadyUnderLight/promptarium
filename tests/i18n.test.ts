/**
 * Issue #35 i18n Foundation — regression tests.
 *
 * Covers locale resolution, preference normalization, catalog key parity,
 * interpolation, missing-key safety and the machine-readable error seam
 * (parseError / isNotFoundError). These map 1:1 onto the acceptance-criteria
 * checklist in the issue.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSystemLocale, normalizePreference } from '../src/lib/i18n/resolve';
import { en } from '../src/lib/i18n/locales/en';
import { zhCN } from '../src/lib/i18n/locales/zh-CN';
import type { MessageKey } from '../src/lib/i18n/locales/en';
import { locale, setPreference, t, interpolateMessage } from '../src/lib/i18n/i18n.svelte';
import { formatDate, formatDateTime, formatNumber } from '../src/lib/i18n/format';
import { parseError, errorDetail, isNotFoundError } from '../src/lib/library/errors';

describe('resolveSystemLocale', () => {
  it('maps Simplified Chinese variants to zh-CN', () => {
    expect(resolveSystemLocale(['zh-CN'])).toBe('zh-CN');
    expect(resolveSystemLocale(['zh-Hans'])).toBe('zh-CN');
    expect(resolveSystemLocale(['zh-Hans-CN'])).toBe('zh-CN');
    expect(resolveSystemLocale(['zh-SG'])).toBe('zh-CN');
    expect(resolveSystemLocale(['zh'])).toBe('zh-CN');
  });

  it('does NOT map Traditional Chinese onto Simplified Chinese in v1', () => {
    expect(resolveSystemLocale(['zh-TW'])).toBe('en');
    expect(resolveSystemLocale(['zh-HK'])).toBe('en');
    expect(resolveSystemLocale(['zh-Hant'])).toBe('en');
    expect(resolveSystemLocale(['zh-Hant-TW'])).toBe('en');
  });

  it('resolves English', () => {
    expect(resolveSystemLocale(['en-US'])).toBe('en');
    expect(resolveSystemLocale(['en'])).toBe('en');
    expect(resolveSystemLocale(['en-GB'])).toBe('en');
  });

  it('falls back to English for unsupported locales', () => {
    expect(resolveSystemLocale(['ja-JP'])).toBe('en');
    expect(resolveSystemLocale(['de-DE'])).toBe('en');
  });

  it('handles empty / malformed lists', () => {
    expect(resolveSystemLocale([])).toBe('en');
    expect(resolveSystemLocale([''])).toBe('en');
    expect(resolveSystemLocale(['bogus-locale'])).toBe('en');
  });

  it('picks the first clearly-supported locale in the list', () => {
    expect(resolveSystemLocale(['zh-TW', 'en-US'])).toBe('en');
    expect(resolveSystemLocale(['ja-JP', 'zh-CN'])).toBe('zh-CN');
    expect(resolveSystemLocale(['zh-TW', 'zh-CN'])).toBe('zh-CN');
  });

  it('normalizes underscores and case', () => {
    expect(resolveSystemLocale(['ZH_CN'])).toBe('zh-CN');
    expect(resolveSystemLocale(['en_GB'])).toBe('en');
  });
});

describe('normalizePreference', () => {
  it('accepts only the three legal values', () => {
    expect(normalizePreference('system')).toBe('system');
    expect(normalizePreference('en')).toBe('en');
    expect(normalizePreference('zh-CN')).toBe('zh-CN');
  });

  it('treats missing / invalid stored values as system', () => {
    expect(normalizePreference(null)).toBe('system');
    expect(normalizePreference('')).toBe('system');
    expect(normalizePreference('fr')).toBe('system');
    expect(normalizePreference('zh_TW')).toBe('system');
  });
});

describe('catalog parity', () => {
  it('en and zh-CN expose exactly the same key set', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('language self-names are locale-independent', () => {
    expect(en['locale.en']).toBe('English');
    expect(en['locale.zhCN']).toBe('简体中文');
    expect(zhCN['locale.en']).toBe('English');
    expect(zhCN['locale.zhCN']).toBe('简体中文');
  });
});

describe('locale state, t() and persistence', () => {
  beforeEach(() => {
    // Deterministic baseline: jsdom exposes no real system language, so
    // `system` resolves to English. Clears any leftover stored preference.
    localStorage.clear();
    setPreference('system');
    expect(locale.resolved).toBe('en');
  });

  it('renders the active locale and switches immediately', () => {
    expect(t('app.language')).toBe('Language');
    setPreference('zh-CN');
    expect(t('app.language')).toBe('语言');
    expect(t('error.projectFolderNotFound')).toBe('项目文件夹未找到');
    expect(t('project.missing.locate')).toBe('重新定位文件夹');
    setPreference('en');
    expect(t('error.projectFolderNotFound')).toBe('Project folder not found');
  });

  it('manual preference wins over system locale', () => {
    setPreference('zh-CN');
    expect(locale.preference).toBe('zh-CN');
    expect(locale.resolved).toBe('zh-CN');
    expect(t('locale.system')).toBe('跟随系统');
  });

  it('persists the choice under promptarium-locale', () => {
    setPreference('zh-CN');
    expect(localStorage.getItem('promptarium-locale')).toBe('zh-CN');
    setPreference('en');
    expect(localStorage.getItem('promptarium-locale')).toBe('en');
  });

  it('rejects illegal preference values', () => {
    setPreference('zh-CN');
    // @ts-expect-error — deliberately passing a runtime-invalid value.
    setPreference('fr');
    expect(locale.preference).toBe('zh-CN');
  });

  it('keeps <html lang> in sync with the active locale', () => {
    expect(document.documentElement.lang).toBe('en');
    setPreference('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    setPreference('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('formatting seam', () => {
  it('formats numbers with locale grouping', () => {
    setPreference('en');
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatNumber(42)).toBe('42');
  });

  it('formats dates through the active locale without guessing', () => {
    const d = new Date(2026, 8, 4);
    setPreference('en');
    const enDate = formatDate(d);
    expect(enDate).toMatch(/2026/);
    setPreference('zh-CN');
    const zhDate = formatDate(d);
    expect(zhDate).toMatch(/2026/);
    expect(zhDate).not.toBe(enDate);
  });

  it('provides date-time and plain number helpers that never throw', () => {
    setPreference('zh-CN');
    expect(formatDateTime(new Date(2026, 8, 4, 9, 30))).toMatch(/2026/);
    expect(formatNumber(0)).toBe('0');
  });
});

describe('interpolation', () => {
  it('replaces {name} placeholders', () => {
    expect(interpolateMessage('Update to v{version}', { version: '0.4.0' })).toBe(
      'Update to v0.4.0'
    );
    expect(interpolateMessage('{a}-{b}', { a: 'x', b: 'y' })).toBe('x-y');
    expect(interpolateMessage('{n}', { n: 42 })).toBe('42');
  });

  it('leaves text without placeholders untouched', () => {
    expect(interpolateMessage('no placeholders', { version: '1' })).toBe('no placeholders');
    expect(interpolateMessage('plain')).toBe('plain');
  });
});

describe('missing-key safety', () => {
  it('never renders undefined — falls back to the raw key', () => {
    const missing = 'does.not.exist' as MessageKey;
    expect(t(missing)).toBe('does.not.exist');
  });
});

describe('parseError — machine state seam', () => {
  it('parses coded errors into code + detail', () => {
    expect(parseError('PROJECT_FOLDER_NOT_FOUND: project folder not found: /Users/me/proj')).toEqual({
      code: 'PROJECT_FOLDER_NOT_FOUND',
      detail: 'project folder not found: /Users/me/proj',
    });
    expect(parseError('PROMPT_FILE_NOT_FOUND: prompt file not found: /p.md')).toEqual({
      code: 'PROMPT_FILE_NOT_FOUND',
      detail: 'prompt file not found: /p.md',
    });
    expect(parseError('PROMPT_CONFLICT: /p.md changed on disk while you were editing it')).toEqual({
      code: 'PROMPT_CONFLICT',
      detail: '/p.md changed on disk while you were editing it',
    });
  });

  it('accepts Error instances', () => {
    expect(parseError(new Error('PROJECT_FOLDER_NOT_FOUND: project folder not found: /x'))).toEqual({
      code: 'PROJECT_FOLDER_NOT_FOUND',
      detail: 'project folder not found: /x',
    });
  });

  it('keeps uncoded / malformed errors with a null code and full detail', () => {
    expect(parseError('something went wrong')).toEqual({ code: null, detail: 'something went wrong' });
    expect(parseError('PROMPT_CONFLICT without colon')).toEqual({
      code: null,
      detail: 'PROMPT_CONFLICT without colon',
    });
    expect(parseError(42)).toEqual({ code: null, detail: '42' });
  });

  it('classifies the not-found family', () => {
    expect(isNotFoundError('PROJECT_FOLDER_NOT_FOUND')).toBe(true);
    expect(isNotFoundError('PROMPT_FILE_NOT_FOUND')).toBe(true);
    expect(isNotFoundError('PROMPT_CONFLICT')).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });

  it('errorDetail strips only the machine prefix, keeping the human diagnostic', () => {
    expect(errorDetail('PROMPT_FILE_NOT_FOUND: prompt file not found: /p.md')).toBe(
      'prompt file not found: /p.md'
    );
    expect(errorDetail('PROJECT_FOLDER_NOT_FOUND: project folder not found: /Users/me/proj')).toBe(
      'project folder not found: /Users/me/proj'
    );
    expect(errorDetail('PROMPT_CONFLICT: /p.md changed on disk while you were editing it')).toBe(
      '/p.md changed on disk while you were editing it'
    );
    expect(errorDetail('plain failure')).toBe('plain failure');
    expect(errorDetail(new Error('PROMPT_FILE_NOT_FOUND: prompt file not found: /x'))).toBe(
      'prompt file not found: /x'
    );
  });
});
