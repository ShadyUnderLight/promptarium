<script lang="ts">
  import { parseVariables } from '$lib/compose/variables';
  import { library, visiblePrompts } from '$lib/library.svelte';
  import type { PromptSummary } from '$lib/prompts/types';
  import PromptListItem from './PromptListItem.svelte';
  import PromptToolbar from './PromptToolbar.svelte';

  interface Props {
    onSelectPrompt: (name: string) => void;
    onNewPrompt: () => void;
    onBatch: (names: string[], action: 'favorite' | 'unfavorite' | 'archive' | 'draft' | 'active' | 'add-tag' | 'remove-tag' | 'delete', tag?: string) => void;
  }

  let { onSelectPrompt, onNewPrompt, onBatch }: Props = $props();
  let selectedNames = $state<string[]>([]);
  const prompts = $derived(visiblePrompts());
  const selectedDocumentVariables = $derived(
    library.selected ? parseVariables(library.selected.body).length : null
  );

  function toggle(name: string): void {
    selectedNames = selectedNames.includes(name)
      ? selectedNames.filter((item) => item !== name)
      : [...selectedNames, name];
  }

  function selectAll(): void {
    selectedNames = prompts.map((prompt) => prompt.name);
  }

  function clearSelection(): void {
    selectedNames = [];
  }

  function handleBatch(action: Parameters<Props['onBatch']>[1], tag?: string): void {
    onBatch(selectedNames, action, tag);
    if (action !== 'delete') selectedNames = [];
  }

  function variableCount(prompt: PromptSummary): number | null {
    return library.selected?.name === prompt.name ? selectedDocumentVariables : null;
  }
</script>

<section class="prompt-library" aria-label="Prompt library">
  <PromptToolbar selectedCount={selectedNames.length} onSelectAll={selectAll} onClearSelection={clearSelection} onBatch={handleBatch} />

  {#if library.loading}
    <div class="library-loading"><span></span><span></span><span></span><span></span></div>
  {:else if !library.activeProjectPath}
    <div class="library-empty">
      <div class="empty-icon">⌘</div>
      <h2>Choose a prompt project</h2>
      <p>Add a folder from the sidebar. Every Markdown file inside becomes a prompt.</p>
      <button type="button" class="btn btn--primary" onclick={onNewPrompt}>Add your first prompt</button>
    </div>
  {:else if library.error?.toLowerCase().includes('project folder not found')}
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
      {#each prompts as prompt (prompt.name)}
        <PromptListItem
          prompt={prompt}
          selected={library.selectedName === prompt.name}
          checked={selectedNames.includes(prompt.name)}
          variableCount={variableCount(prompt)}
          onSelect={() => onSelectPrompt(prompt.name)}
          onToggle={(event) => { event.stopPropagation(); toggle(prompt.name); }}
        />
      {/each}
    </div>
  {/if}
</section>
