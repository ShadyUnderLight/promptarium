<script lang="ts">
  /**
   * UpdateBanner — the app's one update surface. Renders purely off the reactive
   * `update` state in updater.svelte.ts:
   *   available   → actionable banner (Update & restart, ×)
   *   downloading → progress bar
   *   checking / uptodate / error → transient notice from a manual check
   *   idle        → nothing
   *
   * Deliberately NOT a toast (`$lib/prompts/toasts.svelte.ts`). That store
   * documents its own scope: toasts are transient, nothing durable hides in one,
   * and "if you find yourself wanting a toast for something the user must act on
   * later, the toast is the wrong surface." An update notice is exactly that, so
   * it gets its own component rather than bending the toast contract.
   *
   * Bottom-RIGHT, z-index 190 — under the toast stack, which owns
   * bottom-center at z-index 200 (PromptsView.svelte's `.prompts-toasts`).
   * Sharing those coordinates would stack a toast and this banner on top of each
   * other. This is load-bearing, not taste: keep them apart if either moves.
   */
  import { update, installUpdate, dismiss } from '$lib/updater.svelte';
  import { t } from '$lib/i18n/i18n.svelte';
  import Icon from '$lib/components/Icon.svelte';
</script>

{#if update.status === 'available'}
  <div class="update-banner" role="dialog" aria-label={t('update.banner.aria')}>
    <div class="update-banner__row">
      <span class="update-banner__text">{t('update.banner.available', { version: update.newVersion })}</span>
      <button
        class="update-banner__close"
        onclick={dismiss}
        type="button"
        aria-label={t('update.banner.dismiss.aria')}
        title={t('update.banner.dismiss')}
      >
        <Icon name="close" />
      </button>
    </div>
    <div class="update-banner__actions">
      <button class="btn btn--primary btn--sm" onclick={installUpdate} type="button">
        {t('update.banner.install')}
      </button>
    </div>
  </div>
{:else if update.status === 'downloading'}
  <div class="update-banner" role="status">
    <span class="update-banner__text">{t('update.banner.downloading', { progress: update.progress })}</span>
    <div class="update-progress" aria-hidden="true">
      <div class="update-progress__fill" style="width:{update.progress}%"></div>
    </div>
  </div>
{:else if update.status === 'checking'}
  <div class="update-banner update-banner--quiet" role="status">{t('update.banner.checking')}</div>
{:else if update.status === 'uptodate'}
  <div class="update-banner update-banner--quiet" role="status">{t('update.banner.uptodate')}</div>
{:else if update.status === 'error'}
  <div class="update-banner update-banner--quiet" role="status">
    {t('update.banner.failed', { detail: update.error })}
  </div>
{/if}

<style>
  /* 位于右下角并低于 Toast 堆栈；Toast 固定在 z-index 200 的底部中央。
     这里必须保持分离，详见组件注释。 */
  .update-banner {
    position: fixed;
    bottom: 1.25rem;
    right: 1.25rem;
    z-index: var(--z-update);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 16rem;
    max-width: min(90vw, 24rem);
    padding: 0.75rem 1rem;
    border-radius: var(--radius-lg);
    background: var(--surface-overlay);
    color: var(--text);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-overlay);
    font-size: 0.8rem;
  }
  /* Overlay glass（Issue #43）。Banner 浮在真实内容之上，因此 blur 可见；
     上面的实体 overlay surface 始终作为 fallback。 */
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .update-banner {
      background: var(--surface-overlay-glass);
      -webkit-backdrop-filter: blur(var(--glass-blur));
      backdrop-filter: blur(var(--glass-blur));
      box-shadow: var(--glass-highlight), var(--shadow-overlay);
    }
  }
  @media (prefers-reduced-transparency: reduce) {
    .update-banner {
      background: var(--surface-overlay);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: var(--shadow-overlay);
    }
  }
  .update-banner--quiet {
    color: var(--text-muted);
  }
  .update-banner__row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .update-banner__text {
    font-weight: 500;
  }
  .update-banner__close {
    flex: none;
    margin: -0.25rem -0.25rem 0 0;
    padding: 0 0.25rem;
    border: 0;
    background: transparent;
    color: var(--text-faint);
    font-family: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .update-banner__close:hover {
    color: var(--text);
  }
  .update-banner__actions {
    display: flex;
    justify-content: flex-end;
  }
  .update-progress {
    height: 6px;
    width: 100%;
    border-radius: 3px;
    background: var(--bg-subtle);
    overflow: hidden;
  }
  .update-progress__fill {
    height: 100%;
    background: var(--accent-user);
    border-radius: 3px;
    transition: width 0.15s ease;
  }
</style>
