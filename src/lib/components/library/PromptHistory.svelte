<script lang="ts">
  import type { GitFileCommit, GitFileDiff, GitFileHistoryPage, GitRepositoryInfo } from '$lib/prompts/git-types';
  import { formatAuthoredAt } from '$lib/library.svelte';
  import { historyEmptyMessage, historyEmptyReason } from '$lib/prompts/history';
  import DiffViewer from './DiffViewer.svelte';

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

<section class="prompt-history" aria-label="Prompt git history">
  {#if loading}
    <div class="history-loading"><span></span><span></span></div>
  {:else if error}
    <div class="history-empty">
      <p>{error}</p>
    </div>
  {:else if emptyReason}
    <div class="history-empty">
      <p>{historyEmptyMessage(emptyReason)}</p>
    </div>
  {:else if page}
    <div class="history-layout">
      <div class="history-list" role="listbox" aria-label="Commit history">
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
            {loadingMore ? 'Loading…' : 'Load earlier commits'}
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
            <p>Select a commit to view its diff.</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>
