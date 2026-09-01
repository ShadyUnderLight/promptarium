<script lang="ts">
  import { library, setSort, setViewMode, visiblePrompts } from '$lib/library.svelte';
  import type { PromptSort, PromptViewMode } from '$lib/prompts/types';

  interface Props {
    selectedCount: number;
    batchEnabled?: boolean;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onBatch: (action: 'favorite' | 'unfavorite' | 'archive' | 'draft' | 'active' | 'add-tag' | 'remove-tag' | 'delete', tag?: string) => void;
  }

  let { selectedCount, onSelectAll, onClearSelection, onBatch }: Props = $props();
  const visibleCount = $derived(visiblePrompts().length);
  const totalCount = $derived(library.allPrompts.length);
  const models = $derived([...new Set(library.allPrompts.flatMap((prompt) => prompt.metadata.models))].sort((a, b) => a.localeCompare(b)));
  let batchTag = $state('');

  function applyTag(action: 'add-tag' | 'remove-tag'): void {
    if (!batchTag.trim()) return;
    onBatch(action, batchTag.trim());
    batchTag = '';
  }
</script>

<div class="prompt-toolbar">
  {#if selectedCount}
    <div class="batch-toolbar">
      <span class="batch-toolbar__count">{selectedCount} selected</span>
      <button type="button" class="toolbar-button" onclick={onSelectAll}>Select all</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('favorite')}>Favorite</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('unfavorite')}>Unfavorite</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('archive')}>Archive</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('active')}>Active</button>
      <label class="batch-tag-input"><input bind:value={batchTag} placeholder="tag" onkeydown={(event) => event.key === 'Enter' && applyTag('add-tag')} /><button type="button" aria-label="Add tag" onclick={() => applyTag('add-tag')}>＋</button><button type="button" aria-label="Remove tag" onclick={() => applyTag('remove-tag')}>−</button></label>
      <button type="button" class="toolbar-button toolbar-button--danger" onclick={() => onBatch('delete')}>Delete</button>
      <button type="button" class="toolbar-button" onclick={onClearSelection}>Cancel</button>
    </div>
  {:else}
    <div class="prompt-toolbar__count">
      <strong>{visibleCount}</strong> prompt{visibleCount === 1 ? '' : 's'}
      {#if visibleCount !== totalCount}<span>of {totalCount}</span>{/if}
    </div>
    <div class="prompt-toolbar__controls">
      <select aria-label="Sort prompts" value={library.sort} onchange={(event) => setSort(event.currentTarget.value as PromptSort)}>
        <option value="modified-desc">Modified newest</option>
        <option value="modified-asc">Modified oldest</option>
        <option value="name-asc">Name A–Z</option>
        <option value="name-desc">Name Z–A</option>
        <option value="favorite-first">Favorites first</option>
      </select>
      {#if models.length}
        <select aria-label="Filter by model" value={library.modelFilter} onchange={(event) => (library.modelFilter = event.currentTarget.value)}>
          <option value="">All models</option>
          {#each models as model (model)}<option value={model}>{model}</option>{/each}
        </select>
      {/if}
      <div class="view-toggle" aria-label="View mode">
        <button type="button" class:toggle-button--active={library.viewMode === 'list'} class="toggle-button" aria-label="List view" onclick={() => setViewMode('list' as PromptViewMode)}>☷</button>
        <button type="button" class:toggle-button--active={library.viewMode === 'grid'} class="toggle-button" aria-label="Grid view" onclick={() => setViewMode('grid' as PromptViewMode)}>▦</button>
      </div>
    </div>
  {/if}
</div>
