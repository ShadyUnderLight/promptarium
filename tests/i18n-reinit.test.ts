/**
 * Issue #35 — preference persistence across module re-init.
 *
 * i18n.svelte.ts is a module singleton; re-importing it after
 * `vi.resetModules()` re-runs `readPreference()` from localStorage, which is
 * exactly what a cold app launch does. This proves the stored preference
 * survives re-init (not merely that setPreference writes to localStorage).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('i18n preference re-init persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('restores a persisted zh-CN preference on re-init', async () => {
    localStorage.setItem('promptarium-locale', 'zh-CN');
    const mod = await import('../src/lib/i18n/i18n.svelte');
    expect(mod.locale.preference).toBe('zh-CN');
    expect(mod.locale.resolved).toBe('zh-CN');
    expect(mod.t('app.language')).toBe('语言');
  });

  it('restores a persisted en preference on re-init', async () => {
    localStorage.setItem('promptarium-locale', 'en');
    const mod = await import('../src/lib/i18n/i18n.svelte');
    expect(mod.locale.preference).toBe('en');
    expect(mod.locale.resolved).toBe('en');
    expect(mod.t('app.language')).toBe('Language');
  });

  it('falls back to system when nothing is stored', async () => {
    const mod = await import('../src/lib/i18n/i18n.svelte');
    expect(mod.locale.preference).toBe('system');
    // jsdom exposes no real system language, so system resolves to English.
    expect(mod.locale.resolved).toBe('en');
  });

  it('treats an invalid stored value as system on re-init', async () => {
    localStorage.setItem('promptarium-locale', 'fr');
    const mod = await import('../src/lib/i18n/i18n.svelte');
    expect(mod.locale.preference).toBe('system');
    expect(mod.locale.resolved).toBe('en');
  });
});
