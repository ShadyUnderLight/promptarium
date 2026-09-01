<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    batchDelete,
    batchUpdate,
    createPrompt,
    deletePrompt,
    duplicatePrompt,
    dismissExternalChange,
    initLibrary,
    isAllProjects,
    library,
    movePrompt,
    projectDisplayName,
    refreshAllProjects,
    refreshLibrary,
    renamePrompt,
    revealPrompt,
    saveDocument,
    selectPrompt,
    setEditorDirtyProvider,
    setSearchQuery,
    setPaneWidth,
    stopFilesystemWatch,
  } from '$lib/library.svelte';
  import type { PromptDocument, PromptMetadata, PromptSummary } from '$lib/prompts/types';
  import { copyToClipboard } from '$lib/copy';
  import { toasts } from '$lib/prompts/toasts.svelte';
  import ProjectSidebar from './library/ProjectSidebar.svelte';
  import PromptLibrary from './library/PromptLibrary.svelte';
  import PromptDetail from './library/PromptDetail.svelte';
  import NewPromptDialog from './library/NewPromptDialog.svelte';
  import ConfirmDialog from './library/ConfirmDialog.svelte';

  let searchInput: HTMLInputElement | undefined = $state(undefined);
  let detail: { save: () => Promise<void>; discardChanges: () => void } | undefined = $state(undefined);
  let newPromptOpen = $state(false);
  let refreshPending = $state(false);
  let deleteTarget = $state<PromptDocument | null>(null);
  let detailDirty = $state(false);
  let selectedProjectMissing = $derived(
    !isAllProjects() && Boolean(library.error?.toLowerCase().includes('project folder not found'))
  );
  let scopeTitle = $derived(
    isAllProjects()
      ? 'All Projects'
      : library.activeProjectPath
        ? (library.projects.find((item) => item.path === library.activeProjectPath)?.name ?? 'Project')
        : 'Local Markdown workspace'
  );

  onMount(() => {
    setEditorDirtyProvider(() => detailDirty);
    void initLibrary();
    window.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('focus', onWindowFocus);
  });

  onDestroy(() => {
    setEditorDirtyProvider(null);
    void stopFilesystemWatch();
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

  function isCurrentDocument(document: PromptDocument): boolean {
    return (
      library.selectedProjectPath === document.projectPath &&
      library.selectedName === document.name &&
      library.selected?.projectPath === document.projectPath &&
      library.selected.name === document.name
    );
  }

  function openNewPrompt(): void {
    if (!library.projects.length) {
      notice('Add a prompt project first.');
      return;
    }
    if (!isAllProjects() && !library.activeProjectPath) {
      notice('Add a prompt project first.');
      return;
    }
    if (!canNavigate()) return;
    newPromptOpen = true;
  }

  function handleSelect(prompt: PromptSummary): void {
    if (!canNavigate()) return;
    void selectPrompt(prompt.projectPath, prompt.name);
  }

  async function handleCreate(
    projectPath: string,
    name: string,
    body: string,
    metadata: PromptMetadata
  ): Promise<PromptDocument> {
    const created = await createPrompt(projectPath, name, body, metadata);
    newPromptOpen = false;
    notice('Prompt created.');
    return created;
  }

  async function handleSave(
    document: PromptDocument,
    body: string,
    metadata: PromptMetadata,
    frontmatterPrefix: string | undefined,
    metadataDirty: boolean,
    expectedRaw: string | undefined
  ): Promise<PromptDocument> {
    const saved = await saveDocument(document, body, metadata, frontmatterPrefix, metadataDirty, expectedRaw);
    if (isCurrentDocument(document)) detailDirty = false;
    return saved;
  }

  async function handleReload(document: PromptDocument): Promise<void> {
    await selectPrompt(document.projectPath, document.name);
    if (isCurrentDocument(document)) {
      detailDirty = false;
      dismissExternalChange();
    }
  }

  function handleCopy(body: string): void {
    void copyToClipboard(body).then((ok) => notice(ok ? 'Prompt copied.' : 'Copy failed — select the text manually.'));
  }

  function handleReveal(document: PromptDocument): void {
    void revealPrompt(document).catch((error) => notice(errorText(error)));
  }

  function handleRename(document: PromptDocument, newName: string): void {
    if (detailDirty && !canNavigate()) return;
    void renamePrompt(document, newName)
      .then(() => {
        if (isCurrentDocument({ ...document, name: newName })) detailDirty = false;
        notice('Prompt renamed.');
      })
      .catch((error) => notice(errorText(error)));
  }

  function handleMove(document: PromptDocument, destination: string): void {
    if (detailDirty && !canNavigate()) return;
    void movePrompt(document, destination)
      .then(() => {
        if (isCurrentDocument({ ...document, name: destination })) detailDirty = false;
        notice('Prompt moved.');
      })
      .catch((error) => notice(errorText(error)));
  }

  function handleDuplicate(document: PromptDocument, name: string): void {
    if (detailDirty && !canNavigate()) return;
    void duplicatePrompt(document, name)
      .then(() => {
        if (library.selectedProjectPath === document.projectPath && library.selectedName === name) detailDirty = false;
        notice('Prompt duplicated.');
      })
      .catch((error) => notice(errorText(error)));
  }

  function requestDelete(document: PromptDocument): void {
    if (detailDirty && !canNavigate()) return;
    deleteTarget = document;
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const document = deleteTarget;
    try {
      await deletePrompt(document);
    } catch (error) {
      notice(errorText(error));
      return;
    }
    deleteTarget = null;
    if (isCurrentDocument(document)) detailDirty = false;
    notice('Deleted ' + document.name + '.md.');
  }

  async function handleBatch(
    prompts: PromptSummary[],
    action: 'favorite' | 'unfavorite' | 'archive' | 'draft' | 'active' | 'add-tag' | 'remove-tag' | 'delete',
    tag?: string
  ): Promise<boolean> {
    if (!prompts.length) return false;
    if (detailDirty && !canNavigate()) return false;
    if (action === 'delete') {
      const listed = prompts
        .map((prompt) => '• ' + projectDisplayName(prompt.projectPath) + ' — ' + prompt.name + '.md')
        .join('\n');
      if (!window.confirm('Delete these Markdown files?\n\n' + listed + '\n\nThis cannot be undone.')) return false;
      const failures = await batchDelete(prompts);
      reportBatchResult(failures, prompts.length - failures.length);
      return true;
    }
    if ((action === 'add-tag' || action === 'remove-tag') && !tag?.trim()) {
      notice('Enter a tag first.');
      return false;
    }
    const failures = await batchUpdate(prompts, (metadata) => {
      const variables = metadata.variables
        ? Object.fromEntries(Object.entries(metadata.variables).map(([name, doc]) => [name, { ...doc }]))
        : undefined;
      const next = {
        ...metadata,
        tags: [...metadata.tags],
        models: [...metadata.models],
        extra: { ...metadata.extra },
        ...(variables ? { variables } : {}),
      };
      if (action === 'favorite') next.favorite = true;
      if (action === 'unfavorite') next.favorite = false;
      if (action === 'archive') next.status = 'archived';
      if (action === 'draft' || action === 'active') next.status = action;
      if (action === 'add-tag' && tag) next.tags = [...new Set([...next.tags, tag.trim()])];
      if (action === 'remove-tag' && tag) next.tags = next.tags.filter((item) => item !== tag.trim());
      return next;
    });
    reportBatchResult(failures, prompts.length - failures.length);
    return true;
  }

  function formatFailureKey(key: string): string {
    const split = key.split('\u0000');
    if (split.length !== 2) return key;
    return projectDisplayName(split[0]) + ' — ' + split[1];
  }

  function reportBatchResult(failures: string[], succeeded: number): void {
    if (failures.length) notice(succeeded + ' updated; failed: ' + failures.map(formatFailureKey).join(', '));
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

  function refreshCurrentView(options?: { editorDirty?: boolean; reloadSelected?: boolean }): void {
    if (isAllProjects()) void refreshAllProjects(options);
    else void refreshLibrary(options);
  }

  function onWindowFocus(): void {
    if (!detailDirty) refreshCurrentView();
    else refreshCurrentView({ editorDirty: true, reloadSelected: false });
  }

  function handleRefresh(): void {
    if (detailDirty) {
      refreshPending = true;
      return;
    }
    refreshCurrentView();
  }

  async function confirmRefresh(): Promise<void> {
    refreshPending = false;
    detail?.discardChanges();
    detailDirty = false;
    dismissExternalChange();
    if (isAllProjects()) await refreshAllProjects();
    else await refreshLibrary();
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
        <span>{scopeTitle}</span>
      </div>
    </div>
    <label class="global-search">
      <span aria-hidden="true">⌕</span>
      <input bind:this={searchInput} value={library.searchQuery} oninput={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search all prompts…" aria-label="Search all prompts" />
      <kbd>⌘ F</kbd>
    </label>
    <div class="library-topbar__actions">
      <button type="button" class="btn btn--primary btn--sm" onclick={openNewPrompt}>＋ New prompt</button>
      <button type="button" class="icon-button" title="Refresh library" aria-label="Refresh library" onclick={handleRefresh}>↻</button>
    </div>
  </div>

  {#if library.error && !selectedProjectMissing}
    <div class="library-error" role="alert">{library.error}</div>
  {/if}

  {#if !library.fsWatchAvailable && library.fsWatchMessage && !selectedProjectMissing}
    <div class="library-error" role="status">
      Automatic refresh unavailable: {library.fsWatchMessage}. Focus or manual Refresh still works.
    </div>
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
      onDismissExternalChange={dismissExternalChange}
      onNotice={notice}
    />
  </div>
</div>

{#if newPromptOpen}
  <NewPromptDialog
    projects={library.projects}
    defaultProjectPath={library.activeProjectPath ?? library.projects[0]?.path ?? ''}
    defaultFolder={isAllProjects() ? '' : library.folderFilter}
    onCreate={handleCreate}
    onClose={() => (newPromptOpen = false)}
  />
{/if}

{#if deleteTarget}
  <ConfirmDialog
    title="Delete prompt file?"
    message={'Delete “' + deleteTarget.name + '.md” from ' + projectDisplayName(deleteTarget.projectPath) + ' / ' + deleteTarget.relativePath + '? The Markdown file will be permanently deleted.'}
    confirmLabel="Delete file"
    destructive={true}
    onConfirm={confirmDelete}
    onCancel={() => (deleteTarget = null)}
  />
{/if}

{#if refreshPending}
  <ConfirmDialog
    title="Reload prompt from disk?"
    message="This prompt has unsaved changes. Reloading will discard the local edits and read the current Markdown file again."
    confirmLabel="Reload from disk"
    cancelLabel="Keep editing"
    onConfirm={confirmRefresh}
    onCancel={() => (refreshPending = false)}
  />
{/if}

{#if toasts.items.length}
  <div class="prompts-toasts" role="status" aria-live="polite">
    {#each toasts.items as toast (toast.id)}
      <button type="button" class="prompts-toast" onclick={() => toasts.dismiss(toast.id)}>{toast.text}</button>
    {/each}
  </div>
{/if}
