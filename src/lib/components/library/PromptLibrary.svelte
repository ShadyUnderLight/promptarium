<script lang="ts">
  import { isAllProjects, library, projectDisplayName, promptVariableCount, visiblePrompts } from '$lib/library.svelte';
  import { promptKey } from '$lib/library/scope';
  import type { PromptSummary } from '$lib/prompts/types';
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

<section class="prompt-library" aria-label="Prompt library">
  <PromptToolbar selectedCount={selectedKeys.length} batchEnabled={true} onSelectAll={selectAll} onClearSelection={clearSelection} onBatch={handleBatch} />

  {#if library.refreshing}
    <div class="library-refreshing" role="status">Refreshing…</div>
  {/if}

  {#if library.loading}
    <div class="library-loading"><span></span><span></span><span></span><span></span></div>
  {:else if !hasProjects}
    <div class="library-empty">
      <div class="empty-icon">⌘</div>
      <h2>Choose a prompt project</h2>
      <p>Add a folder from the sidebar. Every Markdown file inside becomes a prompt.</p>
      <button type="button" class="btn btn--primary" onclick={onNewPrompt}>Add your first prompt</button>
    </div>
  {:else if !allProjects && library.error?.toLowerCase().includes('project folder not found')}
    <div class="library-empty library-empty--error">
      <div class="empty-icon">!</div>
      <h2>Project folder not found</h2>
      <p>Locate the folder again from the project sidebar, or forget this project.</p>
    </div>
  {:else if !prompts.length}
    <div class="library-empty">
      <div class="empty-icon">⌕</div>
      <h2>{library.searchQuery || library.folderFilter || library.tagFilter ? 'No matching prompts' : 'No prompts yet'}</h2>
      <p>{library.searchQuery || library.folderFilter || library.tagFilter ? 'Try another search or clear a filter.' : 'Create a Markdown prompt to start building this library.'}</p>
      {#if !library.searchQuery && !library.folderFilter && !library.tagFilter}<button type="button" class="btn btn--primary" onclick={onNewPrompt}>＋ New prompt</button>{/if}
    </div>
  {:else}
    <div class={'prompt-list prompt-list--' + library.viewMode} role="listbox" aria-label="Prompts">
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
