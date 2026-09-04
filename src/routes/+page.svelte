<script lang="ts">
  /**
   * +page.svelte — top-level SPA shell for Promptarium.
   *
   * There is exactly one view: the Prompt Library (PromptsView). The shell owns
   * only the app chrome — title, theme toggle and footer. The library workspace
   * owns navigation, search and prompt management.
   */
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { getTheme, toggleTheme } from '$lib/theme';
  import { isTauri } from '$lib/api';
  import { update, openUpdatePrompt } from '$lib/updater.svelte';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';
  import PromptsView from '$lib/components/PromptsView.svelte';

  let theme = $state(getTheme());

  // The footer's update affordance is desktop-only: there is nothing to update
  // in a browser, and `check()` would just throw across an absent IPC bridge.
  // Safe to read at init — this app is SPA-only (`ssr = false` in +layout.ts).
  const isDesktop = isTauri();

  // App version for the footer — only available in the packaged desktop app.
  let appVersion = $state('');

  // The header height feeds the --header-h CSS var that app.css uses to size the
  // scroll region, so we measure it live rather than hardcode it.
  let headerEl: HTMLElement | undefined = $state(undefined);

  onMount(async () => {
    if (isTauri()) {
      try {
        appVersion = await getVersion();
      } catch (e) {
        console.error('[app] getVersion failed', e);
      }
    }
  });

  onMount(() => {
    if (!headerEl) return;
    const setVar = () =>
      document.documentElement.style.setProperty('--header-h', `${headerEl!.offsetHeight}px`);
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(headerEl);
    return () => ro.disconnect();
  });

  function handleToggleTheme(): void {
    theme = toggleTheme();
  }
</script>

<header class="app-header" bind:this={headerEl}>
  <div>
    <h1>Promptarium</h1>
  </div>
  <div class="app-header__actions">
    <LanguageSelector />
    <button class="btn btn--ghost btn--sm" onclick={handleToggleTheme} type="button">
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  </div>
</header>

<main class="container-main">
  <PromptsView />
</main>

<footer class="app-footer">
  <a href="https://github.com/ShadyUnderLight/promptarium" target="_blank" rel="noopener noreferrer">
    Prompt Library{appVersion ? ` v${appVersion}` : ''} — local-first Markdown prompts, organized by project
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
      {update.newVersion ? `Update to v${update.newVersion}` : 'Check for updates'}
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
