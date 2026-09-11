<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import {
    batchDelete,
    batchUpdate,
    createPrompt,
    deletePrompt,
    duplicateAsVariant,
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
  import { errorDetail } from '$lib/library/errors';
  import { t, tPlural } from '$lib/i18n/i18n.svelte';
  import { getTheme, toggleTheme } from '$lib/theme';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';
  import ProjectSidebar from './library/ProjectSidebar.svelte';
  import PromptLibrary from './library/PromptLibrary.svelte';
  import PromptDetail from './library/PromptDetail.svelte';
  import NewPromptDialog from './library/NewPromptDialog.svelte';
  import ConfirmDialog from './library/ConfirmDialog.svelte';

  let searchInput: HTMLInputElement | undefined = $state(undefined);
  let theme = $state(getTheme());
  let detail: { save: () => Promise<void>; discardChanges: () => void } | undefined = $state(undefined);
  let newPromptOpen = $state(false);
  let refreshPending = $state(false);
  let deleteTarget = $state<PromptDocument | null>(null);
  // Prompt Detail owns overlays this shell cannot see (the naming dialog, the
  // Compare modal); it reports whether any of them is open so the global-
  // shortcut guard below yields to it like it does to our own modals.
  let detailModalOpen = $state(false);
  let detailDirty = $state(false);
  let selectedProjectMissing = $derived(
    !isAllProjects() && library.errorCode === 'PROJECT_FOLDER_NOT_FOUND'
  );
  let scopeTitle = $derived(
    isAllProjects()
      ? t('sidebar.allProjects')
      : library.activeProjectPath
        ? (library.projects.find((item) => item.path === library.activeProjectPath)?.name ?? t('topbar.scope.fallbackProject'))
        : t('topbar.scope.localWorkspace')
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

  /** Pending confirmation, while the in-app dialog is open. macOS WKWebView
   *  returns `false` from `window.confirm` without showing anything, which
   *  silently cancelled every guarded action instead of asking; the guard now
   *  awaits this promise. */
  let confirmRequest = $state<{
    title: string;
    message: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  function askConfirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmRequest = { title, message, resolve };
    });
  }

  function settleConfirm(ok: boolean): void {
    const request = confirmRequest;
    confirmRequest = null;
    request?.resolve(ok);
  }

  // Every overlay on screen at once — the four rendered here plus whatever
  // Prompt Detail reports. Each one takes over the keyboard context, so the
  // global shortcuts have to yield to all of them: an overlay this expression
  // forgets is one where ⌘N stacks a second modal, ⌘F steals focus out of it
  // and ⌘S saves the editor hidden behind it.
  const shellModalOpen = $derived(
    newPromptOpen ||
      refreshPending ||
      Boolean(deleteTarget) ||
      Boolean(confirmRequest) ||
      detailModalOpen
  );

  async function canNavigate(): Promise<boolean> {
    if (!detailDirty) return true;
    return askConfirm(t('confirm.unsaved.title'), t('confirm.unsaved.message'));
  }

  function isCurrentDocument(document: PromptDocument): boolean {
    return (
      library.selectedProjectPath === document.projectPath &&
      library.selectedName === document.name &&
      library.selected?.projectPath === document.projectPath &&
      library.selected.name === document.name
    );
  }

  async function openNewPrompt(): Promise<void> {
    if (!library.projects.length) {
      notice(t('notice.addProjectFirst'));
      return;
    }
    if (!isAllProjects() && !library.activeProjectPath) {
      notice(t('notice.addProjectFirst'));
      return;
    }
    if (!(await canNavigate())) return;
    newPromptOpen = true;
  }

  async function handleSelect(prompt: PromptSummary): Promise<void> {
    if (!(await canNavigate())) return;
    void selectPrompt(prompt.projectPath, prompt.name);
  }

  async function handleNavigateRelation(projectPath: string, name: string): Promise<void> {
    if (!(await canNavigate())) return;
    void selectPrompt(projectPath, name);
  }

  async function handleCreate(
    projectPath: string,
    name: string,
    body: string,
    metadata: PromptMetadata
  ): Promise<PromptDocument> {
    const created = await createPrompt(projectPath, name, body, metadata);
    newPromptOpen = false;
    notice(t('notice.promptCreated'));
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
    void copyToClipboard(body).then((ok) => notice(ok ? t('notice.promptCopied') : t('notice.copyFailed')));
  }

  function handleReveal(document: PromptDocument): void {
    void revealPrompt(document).catch((error) => notice(errorDetail(error)));
  }

  async function handleRename(document: PromptDocument, newName: string): Promise<void> {
    if (detailDirty && !(await canNavigate())) return;
    void renamePrompt(document, newName)
      .then(() => {
        if (isCurrentDocument({ ...document, name: newName })) detailDirty = false;
        notice(t('notice.promptRenamed'));
      })
      .catch((error) => notice(errorDetail(error)));
  }

  async function handleMove(document: PromptDocument, destination: string): Promise<void> {
    if (detailDirty && !(await canNavigate())) return;
    void movePrompt(document, destination)
      .then(() => {
        if (isCurrentDocument({ ...document, name: destination })) detailDirty = false;
        notice(t('notice.promptMoved'));
      })
      .catch((error) => notice(errorDetail(error)));
  }

  async function handleDuplicate(document: PromptDocument, name: string): Promise<void> {
    if (detailDirty && !(await canNavigate())) return;
    void duplicatePrompt(document, name)
      .then(() => {
        if (library.selectedProjectPath === document.projectPath && library.selectedName === name) detailDirty = false;
        notice(t('notice.promptDuplicated'));
      })
      .catch((error) => notice(errorDetail(error)));
  }

  async function handleDuplicateAsVariant(document: PromptDocument, name: string): Promise<void> {
    if (detailDirty && !(await canNavigate())) return;
    void duplicateAsVariant(document, name)
      .then(() => {
        if (library.selectedProjectPath === document.projectPath && library.selectedName === name) detailDirty = false;
        notice(t('notice.promptDuplicatedAsVariant'));
      })
      .catch((error) => notice(errorDetail(error)));
  }

  async function requestDelete(document: PromptDocument): Promise<void> {
    if (detailDirty && !(await canNavigate())) return;
    deleteTarget = document;
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const document = deleteTarget;
    try {
      await deletePrompt(document);
    } catch (error) {
      notice(errorDetail(error));
      return;
    }
    deleteTarget = null;
    if (isCurrentDocument(document)) detailDirty = false;
    notice(t('notice.promptDeleted', { name: document.name }));
  }

  async function handleBatch(
    prompts: PromptSummary[],
    action: 'favorite' | 'unfavorite' | 'archive' | 'draft' | 'active' | 'add-tag' | 'remove-tag' | 'delete',
    tag?: string
  ): Promise<boolean> {
    if (!prompts.length) return false;
    if (detailDirty && !(await canNavigate())) return false;
    if (action === 'delete') {
      const listed = prompts
        .map((prompt) => '• ' + projectDisplayName(prompt.projectPath) + ' — ' + prompt.name + '.md')
        .join('\n');
      if (!window.confirm(t('dialog.batchDeleteFiles', { list: listed }))) return false;
      const failures = await batchDelete(prompts);
      reportBatchResult(failures, prompts.length - failures.length);
      return true;
    }
    if ((action === 'add-tag' || action === 'remove-tag') && !tag?.trim()) {
      notice(t('notice.enterTagFirst'));
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
        related: [...metadata.related],
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
    if (failures.length) notice(t('notice.batchFailures', { count: succeeded, failures: failures.map(formatFailureKey).join(', ') }));
    else notice(tPlural('notice.batchUpdated', succeeded));
  }

  function onGlobalKeydown(event: KeyboardEvent): void {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'n' && key !== 'f' && key !== 's') return;

    // An open modal owns the keyboard: swallow the chord rather than acting on
    // the page behind it, so it cannot stack a second modal on top, pull focus
    // out, or save a hidden editor.
    if (shellModalOpen) {
      event.preventDefault();
      return;
    }

    if (key === 'n') {
      event.preventDefault();
      void openNewPrompt();
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

  function handleToggleTheme(): void {
    theme = toggleTheme();
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
    <div class="library-topbar__title" data-tauri-drag-region>
      <span class="app-mark" data-tauri-drag-region><Icon name="sparkle" /></span>
      <div data-tauri-drag-region>
        <h1 data-tauri-drag-region>Promptarium</h1>
        <span data-tauri-drag-region>{scopeTitle}</span>
      </div>
    </div>
    <label class="global-search">
      <span aria-hidden="true"><Icon name="search" /></span>
      <input bind:this={searchInput} value={library.searchQuery} oninput={(event) => setSearchQuery(event.currentTarget.value)} placeholder={t('topbar.search.placeholder')} aria-label={t('topbar.search.aria')} />
      <kbd>⌘ F</kbd>
    </label>
    <div class="library-topbar__actions">
      <LanguageSelector />
      <button type="button" class="btn btn--ghost btn--sm" onclick={handleToggleTheme}>
        {theme === 'dark' ? t('shell.theme.dark') : t('shell.theme.light')}
      </button>
      <button type="button" class="btn btn--primary btn--sm" onclick={openNewPrompt}><Icon name="plus" /> {t('sidebar.newPrompt')}</button>
      <button type="button" class="icon-button" title={t('topbar.refresh')} aria-label={t('topbar.refresh')} onclick={handleRefresh}><Icon name="refresh" /></button>
    </div>
  </div>

  {#if library.error && !selectedProjectMissing}
    <div class="library-error" role="alert">{library.error}</div>
  {/if}

  {#if !library.fsWatchAvailable && library.fsWatchMessage && !selectedProjectMissing}
    <div class="library-error" role="status">
      {t('notice.fsWatchUnavailable', { detail: library.fsWatchMessage })}
    </div>
  {/if}

  <div
    class="library-workspace"
    style={'--sidebar-width:' + library.sidebarWidth + 'px;--library-width:' + library.libraryWidth + 'px'}
  >
    <ProjectSidebar onNewPrompt={openNewPrompt} {canNavigate} onNotice={notice} />
    <button type="button" class="pane-resizer" aria-label={t('panes.resizeSidebar.aria')} onpointerdown={(event) => startResize('sidebar', event)}></button>
    <PromptLibrary onSelectPrompt={handleSelect} onNewPrompt={openNewPrompt} onBatch={handleBatch} />
    <button type="button" class="pane-resizer" aria-label={t('panes.resizeLibrary.aria')} onpointerdown={(event) => startResize('library', event)}></button>
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
      onDuplicateAsVariant={handleDuplicateAsVariant}
      onDeleteRequest={requestDelete}
      onDirtyChange={(dirty) => (detailDirty = dirty)}
      onDismissExternalChange={dismissExternalChange}
      onNotice={notice}
      onNavigate={handleNavigateRelation}
      onModalChange={(open) => (detailModalOpen = open)}
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
    title={t('confirm.deletePrompt.title')}
    message={t('confirm.deletePrompt.message', {
      name: deleteTarget.name,
      project: projectDisplayName(deleteTarget.projectPath),
      path: deleteTarget.relativePath,
    })}
    confirmLabel={t('confirm.deletePrompt.confirm')}
    destructive={true}
    onConfirm={confirmDelete}
    onCancel={() => (deleteTarget = null)}
  />
{/if}

{#if confirmRequest}
  <ConfirmDialog
    title={confirmRequest.title}
    message={confirmRequest.message}
    confirmLabel={t('confirm.unsaved.confirm')}
    cancelLabel={t('confirm.unsaved.cancel')}
    onConfirm={() => settleConfirm(true)}
    onCancel={() => settleConfirm(false)}
  />
{/if}

{#if refreshPending}
  <ConfirmDialog
    title={t('confirm.reload.title')}
    message={t('confirm.reload.message')}
    confirmLabel={t('confirm.reload.confirm')}
    cancelLabel={t('confirm.reload.cancel')}
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
