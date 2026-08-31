<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    batchDelete,
    batchUpdate,
    createPrompt,
    deletePrompt,
    duplicatePrompt,
    initLibrary,
    library,
    movePrompt,
    refreshLibrary,
    renamePrompt,
    revealPrompt,
    saveDocument,
    selectPrompt,
    setSearchQuery,
    setPaneWidth,
    visiblePrompts,
  } from '$lib/library.svelte';
  import type { PromptDocument, PromptMetadata } from '$lib/prompts/types';
  import { copyToClipboard } from '$lib/copy';
  import { toasts } from '$lib/prompts/toasts.svelte';
  import ProjectSidebar from './library/ProjectSidebar.svelte';
  import PromptLibrary from './library/PromptLibrary.svelte';
  import PromptDetail from './library/PromptDetail.svelte';
  import NewPromptDialog from './library/NewPromptDialog.svelte';
  import ConfirmDialog from './library/ConfirmDialog.svelte';

  let searchInput: HTMLInputElement | undefined = $state(undefined);
  let detail: { save: () => Promise<void> } | undefined = $state(undefined);
  let newPromptOpen = $state(false);
  let deleteTarget = $state<PromptDocument | null>(null);
  let detailDirty = $state(false);
  let selectedProjectMissing = $derived(Boolean(library.error?.toLowerCase().includes('project folder not found')));

  onMount(() => {
    void initLibrary();
    window.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('focus', onWindowFocus);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', onGlobalKeydown);
    window.removeEventListener('focus', onWindowFocus);
  });

  function notice(message: string): void {
    toasts.push(message);
  }

  function canNavigate(): boolean {
    if (!detailDirty) return true;
    return window.confirm('This prompt has unsaved changes. Discard them and continue?');
  }

  function openNewPrompt(): void {
    if (!library.activeProjectPath) {
      notice('Add a prompt project first.');
      return;
    }
    if (!canNavigate()) return;
    newPromptOpen = true;
  }

  function handleSelect(name: string): void {
    if (!canNavigate()) return;
    void selectPrompt(name);
  }

  async function handleCreate(name: string, body: string, metadata: PromptMetadata): Promise<PromptDocument> {
    const created = await createPrompt(name, body, metadata);
    newPromptOpen = false;
    notice('Prompt created.');
    return created;
  }

  async function handleSave(
    name: string,
    body: string,
    metadata: PromptMetadata,
    frontmatterPrefix: string | undefined,
    metadataDirty: boolean,
    expectedRaw: string | undefined
  ): Promise<PromptDocument> {
    const saved = await saveDocument(name, body, metadata, frontmatterPrefix, metadataDirty, expectedRaw);
    detailDirty = false;
    return saved;
  }

  async function handleReload(name: string): Promise<void> {
    await selectPrompt(name);
    detailDirty = false;
  }

  function handleCopy(body: string): void {
    void copyToClipboard(body).then((ok) => notice(ok ? 'Prompt copied.' : 'Copy failed — select the text manually.'));
  }

  function handleReveal(name: string): void {
    void revealPrompt(name).catch((error) => notice(errorText(error)));
  }

  function handleRename(name: string, newName: string): void {
    if (detailDirty && !canNavigate()) return;
    detailDirty = false;
    void renamePrompt(name, newName)
      .then(() => notice('Prompt renamed.'))
      .catch((error) => notice(errorText(error)));
  }

  function handleMove(name: string, destination: string): void {
    if (detailDirty && !canNavigate()) return;
    detailDirty = false;
    void movePrompt(name, destination)
      .then(() => notice('Prompt moved.'))
      .catch((error) => notice(errorText(error)));
  }

  function handleDuplicate(document: PromptDocument, name: string): void {
    if (detailDirty && !canNavigate()) return;
    void duplicatePrompt(document, name)
      .then(() => notice('Prompt duplicated.'))
      .catch((error) => notice(errorText(error)));
  }

  function requestDelete(document: PromptDocument): void {
    if (detailDirty && !canNavigate()) return;
    deleteTarget = document;
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    try {
      await deletePrompt(name);
    } catch (error) {
      notice(errorText(error));
      return;
    }
    deleteTarget = null;
    detailDirty = false;
    notice('Deleted ' + name + '.md.');
  }

  async function handleBatch(
    names: string[],
    action: 'favorite' | 'unfavorite' | 'archive' | 'draft' | 'active' | 'add-tag' | 'remove-tag' | 'delete',
    tag?: string
  ): Promise<void> {
    if (!names.length) return;
    if (detailDirty && !canNavigate()) return;
    if (action === 'delete') {
      const listed = names.map((name) => '• ' + name + '.md').join('\n');
      if (!window.confirm('Delete these Markdown files?\n\n' + listed + '\n\nThis cannot be undone.')) return;
      const failures = await batchDelete(names);
      reportBatchResult(failures, names.length - failures.length);
      return;
    }
    if ((action === 'add-tag' || action === 'remove-tag') && !tag?.trim()) {
      notice('Enter a tag first.');
      return;
    }
    const selected = names
      .map((name) => library.allPrompts.find((prompt) => prompt.name === name))
      .filter((prompt): prompt is NonNullable<typeof prompt> => Boolean(prompt));
    const missing = names.filter((name) => !selected.some((prompt) => prompt.name === name));
    const failures = [...missing, ...(await batchUpdate(selected, (metadata) => {
      const next = { ...metadata, tags: [...metadata.tags], models: [...metadata.models], extra: { ...metadata.extra } };
      if (action === 'favorite') next.favorite = true;
      if (action === 'unfavorite') next.favorite = false;
      if (action === 'archive') next.status = 'archived';
      if (action === 'draft' || action === 'active') next.status = action;
      if (action === 'add-tag' && tag) next.tags = [...new Set([...next.tags, tag.trim()])];
      if (action === 'remove-tag' && tag) next.tags = next.tags.filter((item) => item !== tag.trim());
      return next;
    }))];
    reportBatchResult(failures, names.length - failures.length);
  }

  function reportBatchResult(failures: string[], succeeded: number): void {
    if (failures.length) notice(succeeded + ' updated; failed: ' + failures.join(', '));
    else notice(succeeded + ' prompt' + (succeeded === 1 ? '' : 's') + ' updated.');
  }

  function onGlobalKeydown(event: KeyboardEvent): void {
    if (newPromptOpen || deleteTarget) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'n') {
      event.preventDefault();
      openNewPrompt();
    } else if (key === 'f') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (key === 's') {
      if (!detailDirty) return;
      event.preventDefault();
      void detail?.save();
    }
  }

  function onWindowFocus(): void {
    if (!detailDirty) void refreshLibrary();
  }

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function startResize(which: 'sidebar' | 'library', event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startValue = which === 'sidebar' ? library.sidebarWidth : library.libraryWidth;
    const move = (moveEvent: PointerEvent) => {
      const next = startValue + moveEvent.clientX - startX;
      setPaneWidth(which, next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }
</script>

<div class="library-shell" class:library-shell--missing={selectedProjectMissing}>
  <div class="library-topbar">
    <div class="library-topbar__title">
      <span class="app-mark">✦</span>
      <div>
        <h1>Prompt Library</h1>
        <span>{library.activeProjectPath ? (library.projects.find((item) => item.path === library.activeProjectPath)?.name ?? 'Project') : 'Local Markdown workspace'}</span>
      </div>
    </div>
    <label class="global-search">
      <span aria-hidden="true">⌕</span>
      <input bind:this={searchInput} value={library.searchQuery} oninput={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search all prompts…" aria-label="Search all prompts" />
      <kbd>⌘ F</kbd>
    </label>
    <div class="library-topbar__actions">
      <button type="button" class="btn btn--primary btn--sm" onclick={openNewPrompt}>＋ New prompt</button>
      <button type="button" class="icon-button" title="Refresh library" aria-label="Refresh library" onclick={() => refreshLibrary()}>↻</button>
    </div>
  </div>

  {#if library.error && !selectedProjectMissing}
    <div class="library-error" role="alert">{library.error}</div>
  {/if}

  <div
    class="library-workspace"
    style={'--sidebar-width:' + library.sidebarWidth + 'px;--library-width:' + library.libraryWidth + 'px'}
  >
    <ProjectSidebar onNewPrompt={openNewPrompt} {canNavigate} onNotice={notice} />
    <button type="button" class="pane-resizer" aria-label="Resize project sidebar" onpointerdown={(event) => startResize('sidebar', event)}></button>
    <PromptLibrary onSelectPrompt={handleSelect} onNewPrompt={openNewPrompt} onBatch={handleBatch} />
    <button type="button" class="pane-resizer" aria-label="Resize prompt library" onpointerdown={(event) => startResize('library', event)}></button>
    <PromptDetail
      bind:this={detail}
      document={library.selected}
      loading={library.loadingDocument}
      onSave={handleSave}
      onReload={handleReload}
      onCopy={handleCopy}
      onReveal={handleReveal}
      onRename={handleRename}
      onMove={handleMove}
      onDuplicate={handleDuplicate}
      onDeleteRequest={requestDelete}
      onDirtyChange={(dirty) => (detailDirty = dirty)}
      onNotice={notice}
    />
  </div>
</div>

{#if newPromptOpen}
  <NewPromptDialog defaultFolder={library.folderFilter} onCreate={handleCreate} onClose={() => (newPromptOpen = false)} />
{/if}

{#if deleteTarget}
  <ConfirmDialog
    title="Delete prompt file?"
    message={'Delete “' + deleteTarget.name + '.md” from ' + deleteTarget.relativePath + '? The Markdown file will be permanently deleted.'}
    confirmLabel="Delete file"
    destructive={true}
    onConfirm={confirmDelete}
    onCancel={() => (deleteTarget = null)}
  />
{/if}

{#if toasts.items.length}
  <div class="prompts-toasts" role="status" aria-live="polite">
    {#each toasts.items as toast (toast.id)}
      <button type="button" class="prompts-toast" onclick={() => toasts.dismiss(toast.id)}>{toast.text}</button>
    {/each}
  </div>
{/if}
