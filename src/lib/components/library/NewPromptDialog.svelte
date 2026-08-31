<script lang="ts">
  import { onMount } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import type { PromptDocument, PromptMetadata, PromptStatus } from '$lib/prompts/types';
  import { defaultPromptMetadata } from '$lib/prompts/types';

  interface Props {
    defaultFolder?: string;
    onCreate: (name: string, body: string, metadata: PromptMetadata) => Promise<PromptDocument>;
    onClose: () => void;
  }

  let { defaultFolder = '', onCreate, onClose }: Props = $props();
  let nameInput: HTMLInputElement | undefined = $state(undefined);
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

  onMount(() => {
    name = defaultFolder ? defaultFolder + '/' : '';
    nameInput?.focus();
  });

  function listValue(value: string): string[] {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  }

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      error = 'Enter a filename for the prompt.';
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
      await onCreate(trimmed, body, metadata);
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
        <span class="eyebrow">Prompt Library</span>
        <h2 id="new-prompt-title">New prompt</h2>
      </div>
      <button type="button" class="icon-button" aria-label="Close" onclick={onClose}>×</button>
    </div>

    {#if error}<p class="form-error">{error}</p>{/if}

    <label class="field">
      <span>Filename <small>relative path, without .md</small></span>
      <input bind:this={nameInput} bind:value={name} placeholder="coding/review-pr" spellcheck="false" />
    </label>
    <label class="field">
      <span>Prompt Markdown</span>
      <textarea class="new-prompt-body" bind:value={body} placeholder="Write the prompt body…"></textarea>
    </label>

    <div class="metadata-grid metadata-grid--dialog">
      <label class="field field--wide">
        <span>Description</span>
        <input bind:value={description} placeholder="What is this prompt for?" />
      </label>
      <label class="field">
        <span>Status</span>
        <select bind:value={status}>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <label class="field">
        <span>Tags <small>comma separated</small></span>
        <input bind:value={tagsText} placeholder="coding, review" />
      </label>
      <label class="field">
        <span>Models <small>comma separated</small></span>
        <input bind:value={modelsText} placeholder="ChatGPT, Claude" />
      </label>
      <label class="field">
        <span>Created</span>
        <input type="date" bind:value={created} />
      </label>
      <label class="check-field">
        <input type="checkbox" bind:checked={favorite} />
        <span>Favorite</span>
      </label>
    </div>

    <div class="modal__actions">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={busy}>Cancel</button>
      <button type="button" class="btn btn--primary" onclick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create prompt'}</button>
    </div>
  </dialog>
</div>
