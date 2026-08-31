<script lang="ts">
  import { library, promptVariableCount, visiblePrompts } from '$lib/library.svelte';
  import type { PromptSummary } from '$lib/prompts/types';
  import PromptListItem from './PromptListItem.svelte';
  import PromptToolbar from './PromptToolbar.svelte';

  interface Props {
    projectPath: string | null;
    onSelectPrompt: (prompt: PromptSummary) => void;
    onNewPrompt: () => void;
    onBatch: (prompts: PromptSummary[], action: 'favorite' | 'unfavorite' | 'archive' | 'draft' | 'active' | 'add-tag' | 'remove-tag' | 'delete', tag?: string) => Promise<boolean>;
  }

  let { projectPath, onSelectPrompt, onNewPrompt, onBatch }: Props = $props();
  let selectedNames = $state<string[]>([]);
  const prompts = $derived(visiblePrompts());
  $effect(() => {
    projectPath;
    selectedNames = [];
  });

  $effect(() => {
    const available = new Set(prompts.map((prompt) => prompt.name));
    const next = selectedNames.filter((name) => available.has(name));
    if (next.length !== selectedNames.length) selectedNames = next;
  });

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

  async function handleBatch(action: Parameters<Props['onBatch']>[1], tag?: string): Promise<void> {
    const selected = library.allPrompts.filter((prompt) => selectedNames.includes(prompt.name));
    if (await onBatch(selected, action, tag)) selectedNames = [];
  }

  function variableCount(prompt: PromptSummary): number | null {
    return promptVariableCount(prompt);
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
          selected={library.selected?.projectPath === prompt.projectPath && library.selected.name === prompt.name}
          checked={selectedNames.includes(prompt.name)}
          variableCount={variableCount(prompt)}
          onSelect={() => onSelectPrompt(prompt)}
          onToggle={(event) => { event.stopPropagation(); toggle(prompt.name); }}
        />
      {/each}
    </div>
  {/if}
</section>
