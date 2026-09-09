<script lang="ts">
  import { library, setSort, setViewMode, visiblePrompts } from '$lib/library.svelte';
  import type { PromptSort, PromptViewMode } from '$lib/prompts/types';
  import { t, tPlural } from '$lib/i18n/i18n.svelte';
  import Icon from '$lib/components/Icon.svelte';

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
      <span class="batch-toolbar__count">{t('toolbar.selectedCount', { count: selectedCount })}</span>
      <button type="button" class="toolbar-button" onclick={onSelectAll}>{t('toolbar.selectAll')}</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('favorite')}>{t('toolbar.favorite')}</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('unfavorite')}>{t('toolbar.unfavorite')}</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('archive')}>{t('toolbar.archive')}</button>
      <button type="button" class="toolbar-button" onclick={() => onBatch('active')}>{t('toolbar.active')}</button>
      <label class="batch-tag-input"><input bind:value={batchTag} placeholder={t('toolbar.tagPlaceholder')} onkeydown={(event) => event.key === 'Enter' && applyTag('add-tag')} /><button type="button" aria-label={t('toolbar.addTag')} title={t('toolbar.addTag')} onclick={() => applyTag('add-tag')}><Icon name="plus" /></button><button type="button" aria-label={t('toolbar.removeTag')} title={t('toolbar.removeTag')} onclick={() => applyTag('remove-tag')}><Icon name="minus" /></button></label>
      <button type="button" class="toolbar-button toolbar-button--danger" onclick={() => onBatch('delete')}>{t('toolbar.delete')}</button>
      <button type="button" class="toolbar-button" onclick={onClearSelection}>{t('toolbar.cancel')}</button>
    </div>
  {:else}
    <div class="prompt-toolbar__count">
      <strong>{visibleCount}</strong> {tPlural('toolbar.count', visibleCount)}
      {#if visibleCount !== totalCount}<span>{t('toolbar.countOf', { total: totalCount })}</span>{/if}
    </div>
    <div class="prompt-toolbar__controls">
      <select aria-label={t('toolbar.sort.aria')} value={library.sort} onchange={(event) => setSort(event.currentTarget.value as PromptSort)}>
        <option value="modified-desc">{t('toolbar.sort.modifiedDesc')}</option>
        <option value="modified-asc">{t('toolbar.sort.modifiedAsc')}</option>
        <option value="name-asc">{t('toolbar.sort.nameAsc')}</option>
        <option value="name-desc">{t('toolbar.sort.nameDesc')}</option>
        <option value="favorite-first">{t('toolbar.sort.favoriteFirst')}</option>
      </select>
      {#if models.length}
        <select aria-label={t('toolbar.filterModel.aria')} value={library.modelFilter} onchange={(event) => (library.modelFilter = event.currentTarget.value)}>
          <option value="">{t('toolbar.allModels')}</option>
          {#each models as model (model)}<option value={model}>{model}</option>{/each}
        </select>
      {/if}
      <div class="view-toggle" aria-label={t('toolbar.viewMode.aria')}>
        <button type="button" class:toggle-button--active={library.viewMode === 'list'} class="toggle-button" aria-label={t('toolbar.listView')} title={t('toolbar.listView')} onclick={() => setViewMode('list' as PromptViewMode)}><Icon name="list" /></button>
        <button type="button" class:toggle-button--active={library.viewMode === 'grid'} class="toggle-button" aria-label={t('toolbar.gridView')} title={t('toolbar.gridView')} onclick={() => setViewMode('grid' as PromptViewMode)}><Icon name="grid" /></button>
      </div>
    </div>
  {/if}
</div>
