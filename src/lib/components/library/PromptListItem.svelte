<script lang="ts">
  import { formatModifiedAt, promptHealth, promptTitle } from '$lib/library.svelte';
  import type { PromptSummary } from '$lib/prompts/types';
  import { t, tPlural } from '$lib/i18n/i18n.svelte';
  import type { MessageKey } from '$lib/i18n/locales/en';

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
  const issues = $derived(promptHealth(prompt));
  const healthTitle = $derived(issues.map((issue) => issue.message).join('\n'));
  // Display label per status; the machine enum in metadata never changes.
  const statusKey: Record<string, MessageKey> = {
    active: 'newPrompt.status.active',
    draft: 'newPrompt.status.draft',
    archived: 'newPrompt.status.archived',
  };
  const statusLabel = $derived(t(statusKey[prompt.metadata.status] ?? 'newPrompt.status.active'));
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
  <button type="button" class="prompt-list-item__check" aria-label={t('library.select.aria', { name: prompt.name })} onclick={onToggle}>
    <span class:prompt-list-item__checkmark--checked={checked}></span>
  </button>
  <div class="prompt-list-item__body">
    <div class="prompt-list-item__title-row">
      <span class:prompt-list-item__favorite={prompt.metadata.favorite} class="prompt-list-item__star">{prompt.metadata.favorite ? '★' : '☆'}</span>
      <span class="prompt-list-item__title">{promptTitle(prompt.name)}</span>
      {#if issues.length}<span class="health-badge" title={healthTitle}>{'⚠ ' + issues.length}</span>{/if}
    </div>
    <p class="prompt-list-item__description">{prompt.metadata.description || t('library.noDescription')}</p>
    <div class="prompt-list-item__meta">
      {#if projectLabel}<span class="prompt-list-item__project">{projectLabel}</span>{/if}
      <span class="prompt-list-item__path">{prompt.folder || t('library.projectRoot')}</span>
      {#each prompt.metadata.tags.slice(0, 3) as tag (tag)}<span class="tag-chip">#{tag}</span>{/each}
      <span class={'status-chip status-chip--' + prompt.metadata.status}>{statusLabel}</span>
      {#if variableCount !== null}<span>{tPlural('library.variables', variableCount)}</span>{/if}
      <span>{formatModifiedAt(prompt.modifiedAt)}</span>
    </div>
  </div>
</div>
