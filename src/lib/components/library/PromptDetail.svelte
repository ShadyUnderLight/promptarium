<script lang="ts">
  import { tick } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import type { PromptDocument, PromptMetadata, PromptStatus } from '$lib/prompts/types';
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
  import VariableFillDialog from './VariableFillDialog.svelte';
  import NamePromptDialog from './NamePromptDialog.svelte';
  import { parseError } from '$lib/library/errors';
  import { t, tPlural } from '$lib/i18n/i18n.svelte';
  import type { MessageKey } from '$lib/i18n/locales/en';
  import { parseVariables } from '$lib/variables/variables';

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
    onCopy: (body: string) => Promise<boolean>;
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
    /** In-app confirmation forwarded to metadata/example editors. */
    requestConfirm?: (
      title: string,
      message: string,
      options?: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean }
    ) => Promise<boolean>;
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
    requestConfirm,
  }: Props = $props();

  let mode = $state<'preview' | 'edit' | 'history'>('preview');
  let compareOpen = $state(false);
  let actionsOpen = $state(false);
  let actionsMenu = $state<HTMLElement | null>(null);
  let actionsToggle = $state<HTMLButtonElement | null>(null);
  let fillDialogOpen = $state(false);
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
  // The naming step for rename/move/duplicate/variant. `window.prompt` cannot
  // stand in for it: on macOS the WKWebView UI delegate implements no text-input
  // panel, so it resolves to `null` without showing anything and those four
  // actions silently did nothing in the packaged app.
  let nameRequest = $state<{
    title: string;
    initial: string;
    resolve: (value: string | null) => void;
  } | null>(null);
  let bodyEditor = $state<HTMLTextAreaElement | null>(null);
  let detailPane = $state<HTMLElement | null>(null);
  let editSelection = $state<{
    key: string;
    start: number;
    end: number;
  } | null>(null);
  const INSPECTOR_SPLIT_MIN_WIDTH = 640;
  /** Narrow layouts tuck the metadata inspector into a sheet; UI-only. */
  let inspectorOpen = $state(true);
  let inspectorWide = $state(true);
  const inspectorVisible = $derived(inspectorWide || inspectorOpen);

  $effect(() => {
    if (!detailPane || typeof ResizeObserver !== 'function') return;
    let previousWide = true;
    const sync = (width: number): void => {
      const nextWide = width >= INSPECTOR_SPLIT_MIN_WIDTH;
      if (previousWide && !nextWide && mode === 'edit') inspectorOpen = false;
      previousWide = nextWide;
      inspectorWide = nextWide;
    };
    const observer = new ResizeObserver(([entry]) => sync(entry.contentRect.width));
    observer.observe(detailPane);
    return () => observer.disconnect();
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
  const statusKeys: Record<PromptStatus, MessageKey> = {
    active: 'newPrompt.status.active',
    draft: 'newPrompt.status.draft',
    archived: 'newPrompt.status.archived',
  };
  const statusLabel = $derived(
    metadata ? t(statusKeys[metadata.status]) : ''
  );

  $effect(() => {
    const current = document;
    if (!current) {
      loadedKey = '';
      actionsOpen = false;
      editSelection = null;
      fillDialogOpen = false;
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
    actionsOpen = false;
    editSelection = null;
    fillDialogOpen = false;
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

  $effect(() => {
    const current = document;
    const editor = bodyEditor;
    const saved = editSelection;
    if (mode !== 'edit' || !current || !editor || !saved) return;
    const key = current.projectPath + '\u0000' + current.name;
    if (saved.key !== key) return;
    const start = Math.max(0, Math.min(saved.start, editor.value.length));
    const end = Math.max(start, Math.min(saved.end, editor.value.length));
    editor.setSelectionRange(start, end);
    editSelection = null;
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

  // The four naming actions capture `document` before awaiting the dialog: the
  // selected document can change while the dialog is up, and the name the user
  // typed belongs to the one they opened it for.
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

  function actionCopy(): void {
    if (parseVariables(body).length) {
      fillDialogOpen = true;
      return;
    }
    void onCopy(body);
  }

  function captureEditSelection(): void {
    if (mode !== 'edit' || !bodyEditor || !document) return;
    editSelection = {
      key: document.projectPath + '\u0000' + document.name,
      start: bodyEditor.selectionStart,
      end: bodyEditor.selectionEnd,
    };
  }

  function toggleRaw(): void {
    if (!rawVisible) captureEditSelection();
    rawVisible = !rawVisible;
  }

  function setMode(next: 'preview' | 'edit' | 'history'): void {
    if (mode === 'edit' && next !== 'edit') captureEditSelection();
    mode = next;
    if (next === 'edit' && !inspectorWide) {
      inspectorOpen = false;
    }
    if (next === 'history' && document) {
      void loadPromptHistory(document.projectPath, document.name);
    }
  }

  export function showHistory(): void {
    if (document) setMode('history');
  }

  function handleSelectCommit(commit: GitFileCommit): void {
    if (!document) return;
    void selectHistoryCommit(document.projectPath, document.name, commit);
  }

  function handleLoadMoreHistory(): void {
    if (!document) return;
    void loadMorePromptHistory(document.projectPath, document.name);
  }

  function toggleInspector(): void {
    inspectorOpen = !inspectorOpen;
  }

  function toggleActions(): void {
    actionsOpen = !actionsOpen;
  }

  function closeActions(): void {
    actionsOpen = false;
  }

  function handleActionsWindowClick(event: MouseEvent): void {
    if (!actionsOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (actionsMenu?.contains(target) || actionsToggle?.contains(target)) return;
    closeActions();
  }

  function handleActionsKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeActions();
  }

  async function runAction(action: () => void | Promise<void>): Promise<void> {
    closeActions();
    // Let the menu attachment tear down first. Its cleanup returns focus to the
    // Actions trigger, which then becomes the correct owner for any dialog or
    // overlay opened by the action.
    await tick();
    await action();
  }
</script>

<svelte:window onclick={handleActionsWindowClick} />

<section
  bind:this={detailPane}
  class="prompt-detail"
  class:prompt-detail--edit={mode === 'edit'}
  aria-label={t('detail.aria')}
>
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
          {#if dirty}<span class="dirty-dot" role="img" aria-label={t('detail.dirty.title')} title={t('detail.dirty.title')}></span>{/if}
          {#if document.frontmatterError}<span class="warning-badge warning-badge--large" title={document.frontmatterError}><Icon name="warning" /></span>{/if}
        </div>
        <span class="detail-path">{document.relativePath}</span>
        <span class="detail-folder">{document.folder || t('library.projectRoot')} · {formatModifiedAt(document.modifiedAt)}</span>
        <div class="detail-header__chips">
          <span class={'status-chip status-chip--' + metadata.status}>{statusLabel}</span>
          {#each metadata.tags as tag}<span class="tag-chip">#{tag}</span>{/each}
        </div>
      </div>
      <div class="detail-header__actions">
        <button type="button" class="btn btn--primary btn--prominent btn--sm" onclick={actionCopy}>{t('detail.copy')}</button>
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
        <button
          type="button"
          class="btn btn--ghost btn--sm detail-actions__toggle"
          bind:this={actionsToggle}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          aria-controls={actionsOpen ? 'prompt-detail-actions-menu' : undefined}
          onclick={toggleActions}
        >
          <Icon name="more-horizontal" /> {t('detail.actions')}
        </button>
        {#if actionsOpen}
          <div
            id="prompt-detail-actions-menu"
            bind:this={actionsMenu}
            class="detail-actions-menu"
            role="menu"
            aria-label={t('detail.actions')}
            tabindex="-1"
            onkeydown={handleActionsKeydown}
            {@attach focusTrap}
          >
            <button type="button" role="menuitem" class="detail-actions-menu__item" onclick={() => void runAction(actionCompare)}>{t('detail.compare')}</button>
            <button type="button" role="menuitem" class="detail-actions-menu__item" onclick={() => void runAction(actionDuplicate)}>{t('detail.duplicate')}</button>
            <button type="button" role="menuitem" class="detail-actions-menu__item" onclick={() => void runAction(actionDuplicateAsVariant)}>{t('detail.duplicateAsVariant')}</button>
            <button type="button" role="menuitem" class="detail-actions-menu__item" onclick={() => void runAction(actionRename)}>{t('detail.rename')}</button>
            <button type="button" role="menuitem" class="detail-actions-menu__item" onclick={() => void runAction(actionMove)}>{t('detail.move')}</button>
            <button type="button" role="menuitem" class="detail-actions-menu__item detail-actions-menu__item--danger" onclick={() => void runAction(() => onDeleteRequest(document))}>{t('detail.delete')}</button>
          </div>
        {/if}
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
        <button type="button" class="text-button" onclick={toggleRaw}>{rawVisible ? t('detail.hideRaw') : t('detail.showRaw')}</button>
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

    {#if mode === 'edit' && rawVisible}
      <div class="detail-edit-actions">
        {#if dirty}<span class="dirty-dot" role="img" aria-label={t('detail.dirty.title')} title={t('detail.dirty.title')}></span>{/if}
        <button type="button" class="btn btn--primary btn--prominent btn--sm" onclick={save} disabled={!dirty || saving}>
          {saving ? t('detail.saving') : t('detail.save')}
        </button>
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
      <PromptMetadataEditor metadata={metadata} body={body} editing={false} promptNames={projectPromptNames} currentName={document.name} summaries={projectSummaries} projectPath={document.projectPath} refreshVersion={library.searchIndexVersion} {requestConfirm} onChange={updateMetadata} />
      <PromptPreview body={body} />
    {:else}
      <div
        class="editor-layout"
        class:editor-layout--inspector-open={inspectorVisible}
      >
        <div class="editor-canvas">
          <div class="editor-canvas__toolbar">
            {#if !inspectorVisible}
              {#if dirty}<span class="dirty-dot" role="img" aria-label={t('detail.dirty.title')} title={t('detail.dirty.title')}></span>{/if}
              <button type="button" class="btn btn--primary btn--prominent btn--sm" onclick={save} disabled={!dirty || saving}>
                {saving ? t('detail.saving') : t('detail.save')}
              </button>
            {/if}
            <button
              type="button"
              class="btn btn--ghost btn--sm editor-inspector-toggle"
              aria-expanded={inspectorVisible}
              aria-controls="prompt-metadata-inspector"
              onclick={toggleInspector}
            >
              {inspectorVisible ? t('detail.inspector.hide') : t('detail.inspector.show')}
            </button>
          </div>
          <label class="editor-label" for="prompt-body">{t('detail.editor.label')}</label>
          <textarea id="prompt-body" class="prompt-editor" bind:this={bodyEditor} bind:value={body} spellcheck="false" oninput={() => (saveError = '', saveConflict = false)}></textarea>
          <span class="editor-hint">{t('detail.editor.hint')}</span>
        </div>
        <aside
          id="prompt-metadata-inspector"
          class="editor-inspector"
          aria-label={t('detail.inspector.aria')}
        >
          <div class="editor-inspector__actions">
            {#if dirty}<span class="dirty-dot editor-inspector__dirty" role="img" aria-label={t('detail.dirty.title')} title={t('detail.dirty.title')}></span>{/if}
            <button type="button" class="btn btn--primary btn--prominent btn--sm" onclick={save} disabled={!dirty || saving}>
              {saving ? t('detail.saving') : t('detail.save')}
            </button>
            <button type="button" class="btn btn--ghost btn--sm editor-inspector__close" onclick={toggleInspector}>
              {t('detail.inspector.hide')}
            </button>
          </div>
          <div class="editor-inspector__scroll">
            <PromptMetadataEditor
              metadata={metadata}
              body={body}
              editing={true}
              promptNames={projectPromptNames}
              currentName={document.name}
              summaries={projectSummaries}
              projectPath={document.projectPath}
              refreshVersion={library.searchIndexVersion}
              {requestConfirm}
              onChange={updateMetadata}
            >
              {#snippet relationsReadonly()}
                <RelatedList document={document} summaries={library.allPrompts} relatedOverride={metadata!.related} onNavigate={onNavigate} />
                <VariantFamilyList document={document} summaries={projectSummaries} metadataOverride={metadata!} onNavigate={onNavigate} />
              {/snippet}
              {#snippet notesReadonly()}
                <div class="editor-inspector__notes-health">
                  <p class="detail-muted editor-inspector__health-hint">{t('detail.health.savedOnly')}</p>
                  {#if healthIssues.length}
                    <div class="health-section health-section--inspector">
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
                  {#if Object.keys(metadata!.extra).length}
                    <span class="detail-muted">{tPlural('detail.customFields', Object.keys(metadata!.extra).length)}</span>
                  {/if}
                </div>
              {/snippet}
            </PromptMetadataEditor>
          </div>
        </aside>
      </div>
    {/if}

    {#if mode === 'preview'}
      <div class="detail-footer">
        <VariableList body={body} annotations={metadata.variables} />
        <RelatedList document={document} summaries={library.allPrompts} relatedOverride={metadata.related} onNavigate={onNavigate} />
        <ExamplesSection examples={metadata.examples ?? []} projectPath={document.projectPath} refreshVersion={library.searchIndexVersion} />
        <VariantFamilyList document={document} summaries={projectSummaries} metadataOverride={metadata!} onNavigate={onNavigate} />
        {#if Object.keys(metadata.extra).length}<span class="detail-muted">{tPlural('detail.customFields', Object.keys(metadata.extra).length)}</span>{/if}
      </div>
    {/if}
  {/if}
</section>

{#if fillDialogOpen && document && metadata}
  <VariableFillDialog
    body={body}
    annotations={metadata.variables}
    onCopy={onCopy}
    onClose={() => (fillDialogOpen = false)}
  />
{/if}

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
