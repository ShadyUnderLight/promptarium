<script lang="ts">
  import { locale, setPreference, t } from '$lib/i18n/i18n.svelte';
  import type { LocalePreference } from '$lib/i18n/types';

  function onSelect(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement;
    setPreference(select.value as LocalePreference);
  }
</script>

<label class="language-select">
  <span class="language-select__label">{t('app.language')}</span>
  <select
    class="language-select__control"
    aria-label={t('app.language')}
    value={locale.preference}
    onchange={onSelect}
  >
    <option value="system">{t('locale.system')}</option>
    <!-- Self-names stay locale-independent so the switch stays reachable. -->
    <option value="en">English</option>
    <option value="zh-CN">简体中文</option>
  </select>
</label>

<style>
  .language-select {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .language-select__label {
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .language-select__control {
    font-family: inherit;
    font-size: 0.7rem;
    padding: 0.25rem 0.4rem;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }
</style>
