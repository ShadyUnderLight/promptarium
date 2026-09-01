<script lang="ts">
  import type { PromptDocument, PromptMetadata } from '$lib/prompts/types';
  import {
    formatModifiedAt,
    library,
    loadPromptHistory,
    promptTitle,
    selectHistoryCommit,
    loadMorePromptHistory,
  } from '$lib/library.svelte';
  import type { GitFileCommit } from '$lib/prompts/git-types';
  import PromptMetadataEditor from './PromptMetadata.svelte';
  import PromptPreview from './PromptPreview.svelte';
  import PromptHistory from './PromptHistory.svelte';
  import VariableList from './VariableList.svelte';
  import RelatedList from './RelatedList.svelte';

  interface Props {
    document: PromptDocument | null;
    loading: boolean;
    onSave: (
      document: PromptDocument,
      body: string,
      metadata: PromptMetadata,
      frontmatterPrefix: string | undefined,
      metadataDirty: boolean,
      expectedRaw: string | undefined
    ) => Promise<PromptDocument>;
    onReload: (document: PromptDocument) => Promise<void>;
    onCopy: (body: string) => void;
    onReveal: (document: PromptDocument) => void;
    onRename: (document: PromptDocument, newName: string) => void;
    onMove: (document: PromptDocument, destination: string) => void;
    onDuplicate: (document: PromptDocument, name: string) => void;
    onDeleteRequest: (document: PromptDocument) => void;
    onDirtyChange: (dirty: boolean) => void;
    onDismissExternalChange: () => void;
    onNotice: (message: string) => void;
    onNavigate: (projectPath: string, name: string) => void;
  }

  let {
    document,
    loading,
    onSave,
    onCopy,
    onReload,
    onReveal,
    onRename,
    onMove,
    onDuplicate,
    onDeleteRequest,
    onDirtyChange,
    onDismissExternalChange,
    onNotice,
    onNavigate,
  }: Props = $props();

  let mode = $state<'preview' | 'edit' | 'history'>('preview');
  let body = $state('');
  let metadata = $state<PromptMetadata | null>(null);
  let originalBody = $state('');
  let originalMetadata = $state<PromptMetadata | null>(null);
  let originalRaw = $state<string | undefined>(undefined);
  let frontmatterPrefix = $state<string | undefined>(undefined);
  let loadedKey = $state('');
  let rawVisible = $state(false);
  let saveError = $state('');
  let saving = $state(false);

  const dirty = $derived(
    Boolean(document && metadata && originalMetadata && (body !== originalBody || JSON.stringify(metadata) !== JSON.stringify(originalMetadata)))
  );
  const metadataDirty = $derived(
    Boolean(metadata && originalMetadata && JSON.stringify(metadata) !== JSON.stringify(originalMetadata))
  );
  // Names of every prompt in the selected prompt's project, for the Related
  // picker. In All Projects scope `library.allPrompts` spans all projects, so
  // filter to the current project to keep relations project-local.
  const projectPromptNames = $derived(
    library.allPrompts
      .filter((prompt) => prompt.projectPath === document?.projectPath)
      .map((prompt) => prompt.name)
  );

  $effect(() => {
    const current = document;
    if (!current) {
      loadedKey = '';
      metadata = null;
      originalMetadata = null;
      body = '';
      originalBody = '';
      originalRaw = undefined;
      frontmatterPrefix = undefined;
      mode = 'preview';
      return;
    }
    const key = current.projectPath + '\u0000' + current.name + '\u0000' + current.raw;
    if (key === loadedKey) return;
    loadedKey = key;
    body = current.body;
    originalBody = current.body;
    metadata = cloneMetadata(current.metadata);
    originalMetadata = cloneMetadata(current.metadata);
    originalRaw = current.raw;
    frontmatterPrefix = current.frontmatterPrefix;
    mode = 'preview';
    rawVisible = false;
    saveError = '';
  });

  $effect(() => {
    onDirtyChange(dirty);
  });

  function cloneMetadata(value: PromptMetadata): PromptMetadata {
    const variables = value.variables
      ? Object.fromEntries(Object.entries(value.variables).map(([name, doc]) => [name, { ...doc }]))
      : undefined;
    return {
      ...value,
      tags: [...value.tags],
      models: [...value.models],
      related: [...value.related],
      extra: { ...value.extra },
      ...(variables ? { variables } : {}),
    };
  }

  function updateMetadata(value: PromptMetadata): void {
    metadata = value;
    saveError = '';
  }

  export function discardChanges(): void {
    if (!document || !originalMetadata) return;
    body = originalBody;
    metadata = cloneMetadata(originalMetadata);
    saveError = '';
  }

  export async function save(): Promise<void> {
    if (!document || !metadata || !dirty || saving) return;
    saving = true;
    saveError = '';
    try {
      const saved = await onSave(
        document,
        body,
        cloneMetadata(metadata),
        frontmatterPrefix,
        metadataDirty,
        originalRaw
      );
      body = saved.body;
      originalBody = saved.body;
      metadata = cloneMetadata(saved.metadata);
      originalMetadata = cloneMetadata(saved.metadata);
      originalRaw = saved.raw;
      frontmatterPrefix = saved.frontmatterPrefix;
      mode = 'preview';
      onNotice('Prompt saved.');
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  async function toggleFavorite(): Promise<void> {
    if (!metadata) return;
    const next = cloneMetadata(metadata);
    next.favorite = !next.favorite;
    metadata = next;
    if (mode === 'preview') await save();
  }

  async function reloadFromDisk(): Promise<void> {
    if (!document) return;
    await onReload(document);
    saveError = '';
    onDismissExternalChange();
    onNotice('Reloaded the prompt from disk. Local edits were discarded.');
  }

  function keepEditingExternalChange(): void {
    onDismissExternalChange();
  }

  function actionRename(): void {
    if (!document) return;
    const next = window.prompt('Rename prompt file', document.name);
    if (next?.trim() && next.trim() !== document.name) onRename(document, next.trim());
  }

  function actionMove(): void {
    if (!document) return;
    const next = window.prompt('Move prompt to relative path', document.name);
    if (next?.trim() && next.trim() !== document.name) onMove(document, next.trim());
  }

  function actionDuplicate(): void {
    if (!document) return;
    const next = window.prompt('New filename for duplicate', document.name + '-copy');
    if (next?.trim()) onDuplicate(document, next.trim());
  }

  function setMode(next: 'preview' | 'edit' | 'history'): void {
    mode = next;
    if (next === 'history' && document) {
      void loadPromptHistory(document.projectPath, document.name);
    }
  }

  function handleSelectCommit(commit: GitFileCommit): void {
    if (!document) return;
    void selectHistoryCommit(document.projectPath, document.name, commit);
  }

  function handleLoadMoreHistory(): void {
    if (!document) return;
    void loadMorePromptHistory(document.projectPath, document.name);
  }
</script>

<section class="prompt-detail" aria-label="Prompt detail">
  {#if loading}
    <div class="detail-loading"><span></span><span></span></div>
  {:else if !document || !metadata}
    <div class="detail-empty">
      <div class="detail-empty__icon">✦</div>
      <h2>Select a prompt</h2>
      <p>Browse the library to inspect metadata, read the Markdown and manage a prompt.</p>
    </div>
  {:else}
    <div class="detail-header">
      <div class="detail-header__title">
        <div class="detail-title-line">
          <button type="button" class:favorite-button--active={metadata.favorite} class="favorite-button" aria-label={metadata.favorite ? 'Remove favorite' : 'Add favorite'} onclick={toggleFavorite}>{metadata.favorite ? '★' : '☆'}</button>
          <h2>{promptTitle(document.name)}</h2>
          {#if dirty}<span class="dirty-dot" title="Unsaved changes"></span>{/if}
          {#if document.frontmatterError}<span class="warning-badge warning-badge--large" title={document.frontmatterError}>!</span>{/if}
        </div>
        <span class="detail-path">{document.relativePath}</span>
        <span class="detail-folder">{document.folder || 'Project root'} · {formatModifiedAt(document.modifiedAt)}</span>
      </div>
      <div class="detail-header__actions">
        <button type="button" class="btn btn--primary btn--sm" onclick={() => onCopy(body)}>Copy Prompt</button>
        <button type="button" class="btn btn--ghost btn--sm" onclick={() => onReveal(document)}>Reveal</button>
      </div>
    </div>

    <div class="detail-toolbar">
      <div class="detail-tabs" role="tablist" aria-label="Prompt content">
        <button type="button" role="tab" aria-selected={mode === 'preview'} class:detail-tab--active={mode === 'preview'} class="detail-tab" onclick={() => setMode('preview')}>Preview</button>
        <button type="button" role="tab" aria-selected={mode === 'edit'} class:detail-tab--active={mode === 'edit'} class="detail-tab" onclick={() => setMode('edit')}>Edit</button>
        <button type="button" role="tab" aria-selected={mode === 'history'} class:detail-tab--active={mode === 'history'} class="detail-tab" onclick={() => setMode('history')}>History</button>
      </div>
      <div class="detail-actions">
        {#if mode === 'edit'}
          <button type="button" class="btn btn--primary btn--sm" onclick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        {/if}
        <div class="detail-action-group">
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionDuplicate}>Duplicate</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionRename}>Rename</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionMove}>Move</button>
          <button type="button" class="btn btn--ghost btn--sm btn--danger-text" onclick={() => onDeleteRequest(document)}>Delete</button>
        </div>
      </div>
    </div>

    {#if library.externalChangeState === 'disk_changed'}
      <div class="detail-error">
        <span>This prompt changed on disk while you have unsaved edits.</span>
        <span class="detail-error__actions">
          <button type="button" class="btn btn--ghost btn--sm" onclick={reloadFromDisk}>Reload from disk</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={keepEditingExternalChange}>Keep editing</button>
        </span>
      </div>
    {:else if library.externalChangeState === 'file_missing'}
      <div class="detail-error">
        <span>This prompt was deleted or moved externally. Your local edits are still in the editor.</span>
        <span class="detail-error__actions">
          <button type="button" class="btn btn--ghost btn--sm" onclick={keepEditingExternalChange}>Keep editing</button>
        </span>
      </div>
    {/if}

    {#if saveError}<div class="detail-error"><span>{saveError}</span>{#if saveError.includes('CONFLICT')}<span class="detail-error__actions"><button type="button" class="btn btn--ghost btn--sm" onclick={reloadFromDisk}>Reload from disk</button><button type="button" class="btn btn--ghost btn--sm" onclick={() => (saveError = '')}>Keep editing</button></span>{/if}</div>{/if}
    {#if document.frontmatterError}
      <div class="frontmatter-warning">
        <span>Frontmatter warning: {document.frontmatterError}</span>
        <button type="button" class="text-button" onclick={() => (rawVisible = !rawVisible)}>{rawVisible ? 'Hide raw file' : 'Show raw file'}</button>
      </div>
    {/if}

    {#if rawVisible}
      <pre class="raw-file">{document.raw}</pre>
    {:else if mode === 'history'}
      <PromptHistory
        loading={library.historyLoading}
        loadingMore={library.historyLoadingMore}
        repo={library.historyRepo}
        page={library.historyPage}
        selectedCommit={library.historySelectedCommit}
        diff={library.historyDiff}
        diffLoading={library.historyDiffLoading}
        error={library.historyError}
        onSelectCommit={handleSelectCommit}
        onLoadMore={handleLoadMoreHistory}
      />
    {:else if mode === 'preview'}
      <PromptMetadataEditor metadata={metadata} body={body} editing={false} promptNames={projectPromptNames} currentName={document.name} onChange={updateMetadata} />
      <PromptPreview body={body} />
    {:else}
      <div class="editor-layout">
        <div class="editor-main">
          <label class="editor-label" for="prompt-body">Prompt Markdown</label>
          <textarea id="prompt-body" class="prompt-editor" bind:value={body} spellcheck="false" oninput={() => (saveError = '')}></textarea>
          <span class="editor-hint">Markdown is stored as written. Cmd/Ctrl+S saves the file.</span>
        </div>
        <div class="editor-inspector">
          <PromptMetadataEditor metadata={metadata} body={body} editing={true} promptNames={projectPromptNames} currentName={document.name} onChange={updateMetadata} />
        </div>
      </div>
    {/if}

    <div class="detail-footer">
      {#if mode !== 'history'}
        <VariableList body={body} annotations={metadata.variables} />
        <RelatedList document={document} summaries={library.allPrompts} onNavigate={onNavigate} />
        {#if Object.keys(metadata.extra).length}<span class="detail-muted">+ {Object.keys(metadata.extra).length} custom metadata field{Object.keys(metadata.extra).length === 1 ? '' : 's'} preserved</span>{/if}
      {/if}
    </div>
  {/if}
</section>
