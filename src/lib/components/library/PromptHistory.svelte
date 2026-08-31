<script lang="ts">
  import type { GitFileDiff, GitFileHistoryPage, GitRepositoryInfo } from '$lib/prompts/git-types';
  import { formatAuthoredAt } from '$lib/library.svelte';
  import DiffViewer from './DiffViewer.svelte';

  interface Props {
    loading: boolean;
    repo: GitRepositoryInfo | null;
    page: GitFileHistoryPage | null;
    selectedCommit: string | null;
    diff: GitFileDiff | null;
    diffLoading: boolean;
    error: string | null;
    onSelectCommit: (commit: string) => void;
  }

  let {
    loading,
    repo,
    page,
    selectedCommit,
    diff,
    diffLoading,
    error,
    onSelectCommit,
  }: Props = $props();
</script>

<section class="prompt-history" aria-label="Prompt git history">
  {#if loading}
    <div class="history-loading"><span></span><span></span></div>
  {:else if error}
    <div class="history-empty">
      <p>{error}</p>
    </div>
  {:else if !repo?.available}
    {#if repo?.reason === 'git-unavailable'}
      <div class="history-empty">
        <p>本机 Git 不可用，无法在此查看 Prompt 版本历史。</p>
      </div>
    {:else}
      <div class="history-empty">
        <p>此 Project 不在 Git 仓库中。将 Project 放入 Git 仓库后即可在这里查看 Prompt 版本历史。</p>
      </div>
    {/if}
  {:else if page && !page.tracked}
    <div class="history-empty">
      <p>当前 Prompt 尚无 Git 历史。</p>
    </div>
  {:else if page && page.commits.length === 0}
    <div class="history-empty">
      <p>当前 Prompt 尚无 Git 历史。</p>
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
            onclick={() => onSelectCommit(commit.hash)}
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
