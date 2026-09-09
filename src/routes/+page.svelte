<script lang="ts">
  /**
   * +page.svelte — top-level SPA shell for Promptarium.
   *
   * There is exactly one view: the Prompt Library (PromptsView), whose topbar
   * owns the app chrome — title, scope, search, language, theme, new and
   * refresh. The shell owns only the footer: the version tagline and the
   * quiet update entry.
   */
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { isTauri } from '$lib/api';
  import { update, openUpdatePrompt } from '$lib/updater.svelte';
  import { t } from '$lib/i18n/i18n.svelte';
  import PromptsView from '$lib/components/PromptsView.svelte';

  // The footer's update affordance is desktop-only: there is nothing to update
  // in a browser, and `check()` would just throw across an absent IPC bridge.
  // Safe to read at init — this app is SPA-only (`ssr = false` in +layout.ts).
  const isDesktop = isTauri();

  // App version for the footer — only available in the packaged desktop app.
  let appVersion = $state('');

  onMount(async () => {
    if (isTauri()) {
      try {
        appVersion = await getVersion();
      } catch (e) {
        console.error('[app] getVersion failed', e);
      }
    }
  });
</script>

<main class="container-main">
  <PromptsView />
</main>

<footer class="app-footer">
  <a href="https://github.com/ShadyUnderLight/promptarium" target="_blank" rel="noopener noreferrer">
    {t('shell.footer.tagline', { version: appVersion ? ` v${appVersion}` : '' })}
  </a>
  <!--
    The permanent quiet channel for updates. The banner shows a given version at
    most once, ever, so this is what keeps a dismissed or missed update reachable
    — and it is also the only way to ask for a check on demand.
  -->
  {#if isDesktop}
    <span class="app-footer__sep" aria-hidden="true">·</span>
    <button
      class="app-footer__update"
      class:app-footer__update--pending={update.newVersion}
      type="button"
      onclick={openUpdatePrompt}
    >
      {update.newVersion ? t('shell.updateTo', { version: update.newVersion }) : t('shell.checkForUpdates')}
    </button>
  {/if}
</footer>

<style>
  .app-footer__sep {
    color: var(--text-faint);
    margin: 0 0.4rem;
  }
  .app-footer__update {
    font-family: inherit;
    font-size: inherit;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .app-footer__update:hover {
    color: var(--text);
    text-decoration: underline;
  }
  /* A pending update is the one thing here worth a glance — accented, but still
     footer-quiet. It never moves, blinks, or asks. */
  .app-footer__update--pending {
    color: var(--accent-user);
  }
</style>
