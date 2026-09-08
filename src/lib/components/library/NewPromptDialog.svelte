<script lang="ts">
  import { onMount } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import type { Project, PromptDocument, PromptMetadata, PromptStatus } from '$lib/prompts/types';
  import { defaultPromptMetadata } from '$lib/prompts/types';
  import { t } from '$lib/i18n/i18n.svelte';

  interface Props {
    projects: Project[];
    defaultProjectPath: string;
    defaultFolder?: string;
    onCreate: (projectPath: string, name: string, body: string, metadata: PromptMetadata) => Promise<PromptDocument>;
    onClose: () => void;
  }

  let { projects, defaultProjectPath, defaultFolder = '', onCreate, onClose }: Props = $props();
  let nameInput: HTMLInputElement | undefined = $state(undefined);
  let projectPath = $state('');
  let name = $state('');
  let body = $state('');
  let description = $state('');
  let tagsText = $state('');
  let status = $state<PromptStatus>('active');
  let favorite = $state(false);
  let modelsText = $state('');
  let created = $state('');
  let error = $state('');
  let busy = $state(false);
  const showProjectPicker = $derived(projects.length > 1);

  onMount(() => {
    projectPath = defaultProjectPath;
    name = defaultFolder ? defaultFolder + '/' : '';
    nameInput?.focus();
  });

  function listValue(value: string): string[] {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  }

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      error = t('newPrompt.error.filename');
      return;
    }
    if (!projectPath) {
      error = t('newPrompt.error.project');
      return;
    }
    busy = true;
    error = '';
    const metadata = defaultPromptMetadata();
    metadata.description = description.trim();
    metadata.tags = listValue(tagsText);
    metadata.status = status;
    metadata.favorite = favorite;
    metadata.models = listValue(modelsText);
    if (created.trim()) metadata.created = created.trim();
    try {
      await onCreate(projectPath, trimmed, body, metadata);
      onClose();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <dialog open class="modal new-prompt-dialog" aria-labelledby="new-prompt-title" onkeydown={handleKeydown} tabindex="-1" {@attach focusTrap}>
    <div class="dialog-heading">
      <div>
        <span class="eyebrow">{t('topbar.title')}</span>
        <h2 id="new-prompt-title">{t('sidebar.newPrompt')}</h2>
      </div>
      <button type="button" class="icon-button" aria-label={t('newPrompt.close')} onclick={onClose}>×</button>
    </div>

    {#if error}<p class="form-error">{error}</p>{/if}

    {#if showProjectPicker}
      <label class="field">
        <span>{t('newPrompt.project')}</span>
        <select bind:value={projectPath}>
          {#each projects as project (project.path)}
            <option value={project.path}>{project.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <label class="field">
      <span>{t('newPrompt.filename')} <small>{t('newPrompt.filenameHint')}</small></span>
      <input bind:this={nameInput} bind:value={name} placeholder="coding/review-pr" spellcheck="false" />
    </label>
    <label class="field">
      <span>{t('newPrompt.body')}</span>
      <textarea class="new-prompt-body" bind:value={body} placeholder={t('newPrompt.body.placeholder')}></textarea>
    </label>

    <div class="metadata-grid metadata-grid--dialog">
      <label class="field field--wide">
        <span>{t('newPrompt.description')}</span>
        <input bind:value={description} placeholder={t('newPrompt.description.placeholder')} />
      </label>
      <label class="field">
        <span>{t('newPrompt.status')}</span>
        <select bind:value={status}>
          <option value="active">{t('newPrompt.status.active')}</option>
          <option value="draft">{t('newPrompt.status.draft')}</option>
          <option value="archived">{t('newPrompt.status.archived')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('newPrompt.tags')} <small>{t('newPrompt.commaSeparated')}</small></span>
        <input bind:value={tagsText} placeholder="coding, review" />
      </label>
      <label class="field">
        <span>{t('newPrompt.models')} <small>{t('newPrompt.commaSeparated')}</small></span>
        <input bind:value={modelsText} placeholder="ChatGPT, Claude" />
      </label>
      <label class="field">
        <span>{t('newPrompt.created')}</span>
        <input type="date" bind:value={created} />
      </label>
      <label class="check-field">
        <input type="checkbox" bind:checked={favorite} />
        <span>{t('newPrompt.favorite')}</span>
      </label>
    </div>

    <div class="modal__actions">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={busy}>{t('newPrompt.cancel')}</button>
      <button type="button" class="btn btn--primary" onclick={submit} disabled={busy}>{busy ? t('newPrompt.creating') : t('newPrompt.create')}</button>
    </div>
  </dialog>
</div>
