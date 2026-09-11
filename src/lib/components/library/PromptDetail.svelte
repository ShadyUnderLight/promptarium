<script lang="ts">
  import type { PromptDocument, PromptMetadata } from '$lib/prompts/types';
  import { cloneMetadata } from '$lib/prompts/duplicate';
  import { effectiveMetadataForSave } from '$lib/examples/editor-helpers';
  import {
    formatModifiedAt,
    library,
    loadPromptHistory,
    promptHealth,
    promptTitle,
    selectHistoryCommit,
    loadMorePromptHistory,
  } from '$lib/library.svelte';
  import type { GitFileCommit } from '$lib/prompts/git-types';
  import Icon from '$lib/components/Icon.svelte';
  import PromptMetadataEditor from './PromptMetadata.svelte';
  import PromptPreview from './PromptPreview.svelte';
  import PromptHistory from './PromptHistory.svelte';
  import VariableList from './VariableList.svelte';
  import RelatedList from './RelatedList.svelte';
  import VariantFamilyList from './VariantFamilyList.svelte';
  import PromptCompare from './PromptCompare.svelte';
  import ExamplesSection from './ExamplesSection.svelte';
  import NamePromptDialog from './NamePromptDialog.svelte';
  import { parseError } from '$lib/library/errors';
  import { t, tPlural } from '$lib/i18n/i18n.svelte';

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
    onDuplicateAsVariant: (document: PromptDocument, name: string) => void;
    onDeleteRequest: (document: PromptDocument) => void;
    onDirtyChange: (dirty: boolean) => void;
    onDismissExternalChange: () => void;
    onNotice: (message: string) => void;
    onNavigate: (projectPath: string, name: string) => void;
    /** Reports whether any overlay owned by this pane is open, so the shell
     *  can make its global shortcuts (⌘N/⌘F/⌘S) yield, exactly as it already
     *  does for its own modals. Without this a modal was open while ⌘N could
     *  still stack a second one on top and ⌘S could save the editor behind it. */
    onModalChange: (open: boolean) => void;
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
    onDuplicateAsVariant,
    onDeleteRequest,
    onDirtyChange,
    onDismissExternalChange,
    onNotice,
    onNavigate,
    onModalChange,
  }: Props = $props();

  let mode = $state<'preview' | 'edit' | 'history'>('preview');
  let compareOpen = $state(false);
  let body = $state('');
  let metadata = $state<PromptMetadata | null>(null);
  let originalBody = $state('');
  let originalMetadata = $state<PromptMetadata | null>(null);
  let originalRaw = $state<string | undefined>(undefined);
  let frontmatterPrefix = $state<string | undefined>(undefined);
  let loadedKey = $state('');
  let rawVisible = $state(false);
  let saveError = $state('');
  let saveConflict = $state(false);
  let saving = $state(false);

  const dirty = $derived(
    Boolean(document && metadata && originalMetadata && (body !== originalBody || JSON.stringify(metadata) !== JSON.stringify(originalMetadata)))
  );
  // Disk-derived structural issues (Issue #13). Health is derived state only:
  // it reflects the last saved/scan state, so it is shown in Preview rather
  // than while the editor holds unsaved changes.
  const healthIssues = $derived(document ? promptHealth(document) : []);
  // Names of every prompt in the selected prompt's project, for the Related
  // picker. In All Projects scope `library.allPrompts` spans all projects, so
  // filter to the current project to keep relations project-local.
  const projectPromptNames = $derived(
    library.allPrompts
      .filter((prompt) => prompt.projectPath === document?.projectPath)
      .map((prompt) => prompt.name)
  );
  // Summaries of the selected prompt's project, for the Variant family footer
  // and the Compare picker (both scoped to the same project, never cross-wired).
  const projectSummaries = $derived(
    library.allPrompts.filter((prompt) => prompt.projectPath === document?.projectPath)
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
    saveConflict = false;
  });

  $effect(() => {
    onDirtyChange(dirty);
  });

  function updateMetadata(value: PromptMetadata): void {
    metadata = value;
    saveError = '';
    saveConflict = false;
  }

  export function discardChanges(): void {
    if (!document || !originalMetadata) return;
    body = originalBody;
    metadata = cloneMetadata(originalMetadata);
    saveError = '';
    saveConflict = false;
  }

  export async function save(): Promise<void> {
    if (!document || !metadata || !originalMetadata || !dirty || saving) return;
    saving = true;
    saveError = '';
    saveConflict = false;
    try {
      // Effective metadata: strip empty "Add blank" draft entries and, when the
      // examples list is semantically unchanged, restore the original raw AST so
      // a net-zero draft interaction never rewrites a hand-written examples
      // block (Issue #26 review P1). `dirty` is recomputed against the effective
      // metadata, so the net-zero case is not a real metadata edit.
      const { effective, dirty: effectiveMetadataDirty } = effectiveMetadataForSave(
        metadata,
        originalMetadata
      );
      if (body === originalBody && !effectiveMetadataDirty) {
        // Nothing actually changed (e.g. Add blank → nothing → Cmd+S, or an
        // empty draft row created then removed): restore the clean baseline
        // locally without writing to disk.
        metadata = effective;
        originalMetadata = cloneMetadata(effective);
        mode = 'preview';
        onNotice(t('notice.noChanges'));
        return;
      }
      const saved = await onSave(
        document,
        body,
        effective,
        frontmatterPrefix,
        effectiveMetadataDirty,
        originalRaw
      );
      body = saved.body;
      originalBody = saved.body;
      metadata = cloneMetadata(saved.metadata);
      originalMetadata = cloneMetadata(saved.metadata);
      originalRaw = saved.raw;
      frontmatterPrefix = saved.frontmatterPrefix;
      mode = 'preview';
      onNotice(t('notice.promptSaved'));
    } catch (error) {
      const parsed = parseError(error);
      saveError = parsed.detail;
      saveConflict = parsed.code === 'PROMPT_CONFLICT';
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
    saveConflict = false;
    onDismissExternalChange();
    onNotice(t('notice.reloaded'));
  }

  function keepEditingExternalChange(): void {
    onDismissExternalChange();
  }

  /** Pending naming step, while the in-app dialog is open. macOS WKWebView
   *  shows no native `window.prompt` at all (it resolves to `null`), so the
   *  name has to come from our own dialog; the actions await this promise. */
  let nameRequest = $state<{
    title: string;
    initial: string;
    resolve: (value: string | null) => void;
  } | null>(null);

  // Everything this pane puts on top of the shell: the naming dialog and the
  // Compare modal, mirroring the conditions they are rendered under. A third
  // overlay only has to join this expression — the shell never learns about it
  // separately, so it cannot forget to yield to one.
  const modalOpen = $derived(
    Boolean(nameRequest) || (compareOpen && Boolean(document) && Boolean(metadata))
  );

  $effect(() => {
    onModalChange(modalOpen);
  });

  function askName(title: string, initial: string): Promise<string | null> {
    return new Promise((resolve) => {
      nameRequest = { title, initial, resolve };
    });
  }

  function settleName(value: string | null): void {
    const request = nameRequest;
    nameRequest = null;
    request?.resolve(value);
  }

  async function actionRename(): Promise<void> {
    const current = document;
    if (!current) return;
    const next = (await askName(t('dialog.renamePrompt'), current.name))?.trim();
    if (next && next !== current.name) onRename(current, next);
  }

  async function actionMove(): Promise<void> {
    const current = document;
    if (!current) return;
    const next = (await askName(t('dialog.movePrompt'), current.name))?.trim();
    if (next && next !== current.name) onMove(current, next);
  }

  async function actionDuplicate(): Promise<void> {
    const current = document;
    if (!current) return;
    const next = (await askName(t('dialog.duplicateName'), current.name + '-copy'))?.trim();
    if (next) onDuplicate(current, next);
  }

  async function actionDuplicateAsVariant(): Promise<void> {
    const current = document;
    if (!current) return;
    const next = (await askName(t('dialog.variantName'), current.name + '-variant'))?.trim();
    if (next) onDuplicateAsVariant(current, next);
  }

  function actionCompare(): void {
    if (!document) return;
    compareOpen = true;
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

<section class="prompt-detail" aria-label={t('detail.aria')}>
  {#if loading}
    <div class="detail-loading"><span></span><span></span></div>
  {:else if !document || !metadata}
    <div class="detail-empty">
      <div class="detail-empty__icon"><Icon name="sparkle" /></div>
      <h2>{t('detail.select.title')}</h2>
      <p>{t('detail.select.hint')}</p>
    </div>
  {:else}
    <div class="detail-header">
      <div class="detail-header__title">
        <div class="detail-title-line">
          <button type="button" class:favorite-button--active={metadata.favorite} class="favorite-button" aria-label={metadata.favorite ? t('detail.favorite.remove') : t('detail.favorite.add')} title={metadata.favorite ? t('detail.favorite.remove') : t('detail.favorite.add')} onclick={toggleFavorite}><Icon name={metadata.favorite ? 'star' : 'star-outline'} /></button>
          <h2>{promptTitle(document.name)}</h2>
          {#if dirty}<span class="dirty-dot" title={t('detail.dirty.title')}></span>{/if}
          {#if document.frontmatterError}<span class="warning-badge warning-badge--large" title={document.frontmatterError}><Icon name="warning" /></span>{/if}
        </div>
        <span class="detail-path">{document.relativePath}</span>
        <span class="detail-folder">{document.folder || t('library.projectRoot')} · {formatModifiedAt(document.modifiedAt)}</span>
      </div>
      <div class="detail-header__actions">
        <button type="button" class="btn btn--primary btn--sm" onclick={() => onCopy(body)}>{t('detail.copy')}</button>
        <button type="button" class="btn btn--ghost btn--sm" onclick={() => onReveal(document)}>{t('detail.reveal')}</button>
      </div>
    </div>

    <div class="detail-toolbar">
      <div class="detail-tabs" role="tablist" aria-label={t('detail.tabs.aria')}>
        <button type="button" role="tab" aria-selected={mode === 'preview'} class:detail-tab--active={mode === 'preview'} class="detail-tab" onclick={() => setMode('preview')}>{t('detail.tab.preview')}</button>
        <button type="button" role="tab" aria-selected={mode === 'edit'} class:detail-tab--active={mode === 'edit'} class="detail-tab" onclick={() => setMode('edit')}>{t('detail.tab.edit')}</button>
        <button type="button" role="tab" aria-selected={mode === 'history'} class:detail-tab--active={mode === 'history'} class="detail-tab" onclick={() => setMode('history')}>{t('detail.tab.history')}</button>
      </div>
      <div class="detail-actions">
        {#if mode === 'edit'}
          <button type="button" class="btn btn--primary btn--sm" onclick={save} disabled={!dirty || saving}>{saving ? t('detail.saving') : t('detail.save')}</button>
        {/if}
        <div class="detail-action-group">
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionCompare}>{t('detail.compare')}</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionDuplicate}>{t('detail.duplicate')}</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionDuplicateAsVariant}>{t('detail.duplicateAsVariant')}</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionRename}>{t('detail.rename')}</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={actionMove}>{t('detail.move')}</button>
          <button type="button" class="btn btn--ghost btn--sm btn--danger-text" onclick={() => onDeleteRequest(document)}>{t('detail.delete')}</button>
        </div>
      </div>
    </div>

    {#if library.externalChangeState === 'file_missing'}
      <div class="detail-error">
        <span>{t('detail.externalMissing')}</span>
        <span class="detail-error__actions">
          <button type="button" class="btn btn--ghost btn--sm" onclick={keepEditingExternalChange}>{t('detail.keepEditing')}</button>
        </span>
      </div>
    {/if}

    {#if saveError}<div class="detail-error"><span>{saveError}</span>{#if saveConflict}<span class="detail-error__actions"><button type="button" class="btn btn--ghost btn--sm" onclick={reloadFromDisk}>{t('detail.reloadFromDisk')}</button><button type="button" class="btn btn--ghost btn--sm" onclick={() => (saveError = '', saveConflict = false)}>{t('detail.keepEditing')}</button></span>{/if}</div>{/if}
    {#if document.frontmatterError}
      <div class="frontmatter-warning">
        <span>{t('detail.frontmatterWarning', { detail: document.frontmatterError })}</span>
        <button type="button" class="text-button" onclick={() => (rawVisible = !rawVisible)}>{rawVisible ? t('detail.hideRaw') : t('detail.showRaw')}</button>
      </div>
    {/if}

    {#if mode === 'preview' && healthIssues.length}
      <div class="health-section">
        <div class="health-section__heading">{t('detail.healthHeading')}</div>
        {#each healthIssues as issue (issue.code + '\u0000' + JSON.stringify(issue.params ?? {}))}
          <div class="health-issue health-issue--{issue.severity}">
            <span class="health-issue__mark"><Icon name="warning" /></span>
            <span class="health-issue__text">{t(`health.${issue.code}`, issue.params)}</span>
            <span class="health-issue__detail">{t(`health.${issue.code}.detail`, issue.params)}</span>
          </div>
        {/each}
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
      <PromptMetadataEditor metadata={metadata} body={body} editing={false} promptNames={projectPromptNames} currentName={document.name} summaries={projectSummaries} projectPath={document.projectPath} refreshVersion={library.searchIndexVersion} onChange={updateMetadata} />
      <PromptPreview body={body} />
    {:else}
      <div class="editor-layout">
        <div class="editor-main">
          <label class="editor-label" for="prompt-body">{t('detail.editor.label')}</label>
          <textarea id="prompt-body" class="prompt-editor" bind:value={body} spellcheck="false" oninput={() => (saveError = '', saveConflict = false)}></textarea>
          <span class="editor-hint">{t('detail.editor.hint')}</span>
        </div>
        <div class="editor-inspector">
          <PromptMetadataEditor metadata={metadata} body={body} editing={true} promptNames={projectPromptNames} currentName={document.name} summaries={projectSummaries} projectPath={document.projectPath} refreshVersion={library.searchIndexVersion} onChange={updateMetadata} />
        </div>
      </div>
    {/if}

    <div class="detail-footer">
      {#if mode !== 'history'}
        <VariableList body={body} annotations={metadata.variables} />
        <RelatedList document={document} summaries={library.allPrompts} relatedOverride={metadata.related} onNavigate={onNavigate} />
        {#if mode === 'preview'}
          <ExamplesSection examples={metadata.examples ?? []} projectPath={document.projectPath} refreshVersion={library.searchIndexVersion} />
        {/if}
        <VariantFamilyList document={document} summaries={projectSummaries} onNavigate={onNavigate} />
        {#if Object.keys(metadata.extra).length}<span class="detail-muted">{tPlural('detail.customFields', Object.keys(metadata.extra).length)}</span>{/if}
      {/if}
    </div>
  {/if}
</section>

{#if nameRequest}
  <NamePromptDialog
    title={nameRequest.title}
    initialValue={nameRequest.initial}
    onConfirm={settleName}
    onCancel={() => settleName(null)}
  />
{/if}

{#if compareOpen && document && metadata}
  <PromptCompare
    document={document}
    leftBody={body}
    leftMetadata={metadata}
    leftDirty={dirty}
    summaries={projectSummaries}
    onClose={() => (compareOpen = false)}
  />
{/if}
