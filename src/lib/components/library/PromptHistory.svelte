<script lang="ts">
  import type { GitFileCommit, GitFileDiff, GitFileHistoryPage, GitRepositoryInfo } from '$lib/prompts/git-types';
  import { formatAuthoredAt } from '$lib/library.svelte';
  import { historyEmptyReason, type HistoryEmptyReason } from '$lib/prompts/history';
  import { t } from '$lib/i18n/i18n.svelte';
  import type { MessageKey } from '$lib/i18n/locales/en';
  import DiffViewer from './DiffViewer.svelte';

  /** Empty-state copy is keyed by the stable reason enum; the domain helper
   *  never renders locale-dependent text itself. */
  const emptyKeys: Record<HistoryEmptyReason, MessageKey> = {
    'git-unavailable': 'history.empty.git-unavailable',
    'not-a-repository': 'history.empty.not-a-repository',
    untracked: 'history.empty.untracked',
    'no-commits': 'history.empty.no-commits',
  };

  interface Props {
    loading: boolean;
    loadingMore: boolean;
    repo: GitRepositoryInfo | null;
    page: GitFileHistoryPage | null;
    selectedCommit: string | null;
    diff: GitFileDiff | null;
    diffLoading: boolean;
    error: string | null;
    onSelectCommit: (commit: GitFileCommit) => void;
    onLoadMore: () => void;
  }

  let {
    loading,
    loadingMore,
    repo,
    page,
    selectedCommit,
    diff,
    diffLoading,
    error,
    onSelectCommit,
    onLoadMore,
  }: Props = $props();

  const emptyReason = $derived(historyEmptyReason(repo, page));
</script>

<section class="prompt-history" aria-label={t('history.aria')}>
  {#if loading}
    <div class="history-loading"><span></span><span></span></div>
  {:else if error}
    <div class="history-empty">
      <p>{error}</p>
    </div>
  {:else if emptyReason}
    <div class="history-empty">
      <p>{t(emptyKeys[emptyReason])}</p>
    </div>
  {:else if page}
    <div class="history-layout">
      <div class="history-list" role="listbox" aria-label={t('history.list.aria')}>
        {#each page.commits as commit (commit.hash)}
          <button
            type="button"
            role="option"
            aria-selected={selectedCommit === commit.hash}
            class="history-item"
            class:history-item--active={selectedCommit === commit.hash}
            onclick={() => onSelectCommit(commit)}
          >
            <span class="history-item__time">{formatAuthoredAt(commit.authoredAt)}</span>
            <span class="history-item__subject">{commit.subject}</span>
            <span class="history-item__meta">
              <span class="history-item__hash">{commit.shortHash}</span>
              {#if commit.authorName}
                <span class="history-item__author">{commit.authorName}</span>
              {/if}
            </span>
          </button>
        {/each}
        {#if page.nextCursor}
          <button
            type="button"
            class="btn btn--ghost btn--sm history-load-more"
            onclick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t('history.loading') : t('history.loadMore')}
          </button>
        {/if}
      </div>
      <div class="history-diff-panel">
        {#if diffLoading}
          <div class="history-loading history-loading--compact"><span></span><span></span></div>
        {:else if diff?.patch}
          <DiffViewer patch={diff.patch} />
        {:else}
          <div class="history-empty history-empty--compact">
            <p>{t('history.selectCommit')}</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>
