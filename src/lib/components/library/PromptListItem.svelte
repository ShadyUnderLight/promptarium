<script lang="ts">
  import { formatModifiedAt, promptTitle } from '$lib/library.svelte';
  import type { PromptSummary } from '$lib/prompts/types';

  interface Props {
    prompt: PromptSummary;
    projectLabel?: string | null;
    selected: boolean;
    checked: boolean;
    variableCount: number | null;
    onSelect: () => void;
    onToggle: (event: MouseEvent) => void;
  }

  let { prompt, projectLabel = null, selected, checked, variableCount, onSelect, onToggle }: Props = $props();
</script>

<div
  class="prompt-list-item"
  class:prompt-list-item--selected={selected}
  role="option"
  aria-selected={selected}
  tabindex="0"
  onclick={onSelect}
  onkeydown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), onSelect())}
>
  <button type="button" class="prompt-list-item__check" aria-label={'Select ' + prompt.name} onclick={onToggle}>
    <span class:prompt-list-item__checkmark--checked={checked}></span>
  </button>
  <div class="prompt-list-item__body">
    <div class="prompt-list-item__title-row">
      <span class:prompt-list-item__favorite={prompt.metadata.favorite} class="prompt-list-item__star">{prompt.metadata.favorite ? '★' : '☆'}</span>
      <span class="prompt-list-item__title">{promptTitle(prompt.name)}</span>
      {#if prompt.frontmatterError}<span class="warning-badge" title={prompt.frontmatterError}>!</span>{/if}
    </div>
    <p class="prompt-list-item__description">{prompt.metadata.description || 'No description yet'}</p>
    <div class="prompt-list-item__meta">
      {#if projectLabel}<span class="prompt-list-item__project">{projectLabel}</span>{/if}
      <span class="prompt-list-item__path">{prompt.folder || 'Project root'}</span>
      {#each prompt.metadata.tags.slice(0, 3) as tag (tag)}<span class="tag-chip">#{tag}</span>{/each}
      <span class={'status-chip status-chip--' + prompt.metadata.status}>{prompt.metadata.status}</span>
      {#if variableCount !== null}<span>{variableCount} variable{variableCount === 1 ? '' : 's'}</span>{/if}
      <span>{formatModifiedAt(prompt.modifiedAt)}</span>
    </div>
  </div>
</div>
