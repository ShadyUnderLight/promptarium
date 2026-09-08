<script lang="ts">
  import { isAllProjects, library, projectDisplayName, promptVariableCount, visiblePrompts } from '$lib/library.svelte';
  import { promptKey } from '$lib/library/scope';
  import type { PromptSummary } from '$lib/prompts/types';
  import { t } from '$lib/i18n/i18n.svelte';
  import PromptListItem from './PromptListItem.svelte';
  import PromptToolbar from './PromptToolbar.svelte';

  interface Props {
    onSelectPrompt: (prompt: PromptSummary) => void;
    onNewPrompt: () => void;
    onBatch: (prompts: PromptSummary[], action: 'favorite' | 'unfavorite' | 'archive' | 'draft' | 'active' | 'add-tag' | 'remove-tag' | 'delete', tag?: string) => Promise<boolean>;
  }

  let { onSelectPrompt, onNewPrompt, onBatch }: Props = $props();
  let selectedKeys = $state<string[]>([]);
  const prompts = $derived(visiblePrompts());
  const allProjects = $derived(isAllProjects());
  const hasProjects = $derived(library.projects.length > 0);

  $effect(() => {
    library.libraryScope;
    selectedKeys = [];
  });

  $effect(() => {
    const available = new Set(prompts.map((prompt) => promptKey(prompt.projectPath, prompt.name)));
    const next = selectedKeys.filter((key) => available.has(key));
    if (next.length !== selectedKeys.length) selectedKeys = next;
  });

  function toggle(prompt: PromptSummary): void {
    const key = promptKey(prompt.projectPath, prompt.name);
    selectedKeys = selectedKeys.includes(key)
      ? selectedKeys.filter((item) => item !== key)
      : [...selectedKeys, key];
  }

  function selectAll(): void {
    selectedKeys = prompts.map((prompt) => promptKey(prompt.projectPath, prompt.name));
  }

  function clearSelection(): void {
    selectedKeys = [];
  }

  async function handleBatch(action: Parameters<Props['onBatch']>[1], tag?: string): Promise<void> {
    const selected = prompts.filter((prompt) => selectedKeys.includes(promptKey(prompt.projectPath, prompt.name)));
    if (await onBatch(selected, action, tag)) selectedKeys = [];
  }

  function variableCount(prompt: PromptSummary): number | null {
    return promptVariableCount(prompt);
  }

  function isSelected(prompt: PromptSummary): boolean {
    return (
      library.selectedProjectPath === prompt.projectPath &&
      library.selectedName === prompt.name &&
      library.selected?.projectPath === prompt.projectPath &&
      library.selected.name === prompt.name
    );
  }
</script>

<section class="prompt-library" aria-label={t('library.section.aria')}>
  <PromptToolbar selectedCount={selectedKeys.length} batchEnabled={true} onSelectAll={selectAll} onClearSelection={clearSelection} onBatch={handleBatch} />

  {#if library.refreshing}
    <div class="library-refreshing" role="status">{t('library.refreshing')}</div>
  {/if}

  {#if library.loading}
    <div class="library-loading"><span></span><span></span><span></span><span></span></div>
  {:else if !hasProjects}
    <div class="library-empty">
      <div class="empty-icon">⌘</div>
      <h2>{t('library.chooseProject')}</h2>
      <p>{t('library.emptyNoProjects')}</p>
      <button type="button" class="btn btn--primary" onclick={onNewPrompt}>{t('library.addFirstPrompt')}</button>
    </div>
  {:else if !allProjects && library.errorCode === 'PROJECT_FOLDER_NOT_FOUND'}
    <div class="library-empty library-empty--error">
      <div class="empty-icon">!</div>
      <h2>{t('error.projectFolderNotFound')}</h2>
      <p>{t('project.missing.hint')}</p>
    </div>
  {:else if !prompts.length}
    <div class="library-empty">
      <div class="empty-icon">⌕</div>
      <h2>{library.searchQuery || library.folderFilter || library.tagFilter ? t('library.noMatching') : t('library.noPromptsYet')}</h2>
      <p>{library.searchQuery || library.folderFilter || library.tagFilter ? t('library.tryAnotherSearch') : t('library.createFirstPrompt')}</p>
      {#if !library.searchQuery && !library.folderFilter && !library.tagFilter}<button type="button" class="btn btn--primary" onclick={onNewPrompt}>＋ {t('sidebar.newPrompt')}</button>{/if}
    </div>
  {:else}
    <div class={'prompt-list prompt-list--' + library.viewMode} role="listbox" aria-label={t('library.list.aria')}>
      {#each prompts as prompt (promptKey(prompt.projectPath, prompt.name))}
        <PromptListItem
          prompt={prompt}
          projectLabel={allProjects ? projectDisplayName(prompt.projectPath) : null}
          selected={isSelected(prompt)}
          checked={selectedKeys.includes(promptKey(prompt.projectPath, prompt.name))}
          variableCount={variableCount(prompt)}
          onSelect={() => onSelectPrompt(prompt)}
          onToggle={(event) => { event.stopPropagation(); toggle(prompt); }}
        />
      {/each}
    </div>
  {/if}
</section>
